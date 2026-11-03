import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { prisma } from "@/lib/prisma";
import { getAgentAccess } from "@/modules/agents/access";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ agentId: string; grantId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  if (!isTrustedMutationRequest(request)) return apiError("INVALID_ORIGIN", 403);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);

  const { agentId, grantId } = await context.params;
  const access = await getAgentAccess(agentId, session.user.id);
  if (!access?.canManagePermissions) return apiError("FORBIDDEN", 403);

  const correlationId = randomUUID();
  const result = await prisma.$transaction(async (tx) => {
    const grant = await tx.permissionGrant.findFirst({
      where: { id: grantId, agentId },
      select: { id: true, status: true, version: true },
    });
    if (!grant) return { state: "NOT_FOUND" as const };

    if (grant.status !== "ACTIVE") return { state: "NOT_ACTIVE" as const };

    const changed = await tx.permissionGrant.updateMany({
      where: { id: grantId, agentId, status: "ACTIVE" },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) return { state: "CONFLICT" as const };

    await tx.auditEvent.create({
      data: {
        actorUserId: session.user.id,
        agentId,
        ownerType: access.ownerType,
        ownerId: access.ownerId,
        action: "permission_grant.revoked",
        targetType: "PermissionGrant",
        targetId: grantId,
        outcome: "COMPLETED",
        policyVersion: String(grant.version + 1),
        correlationId,
      },
    });
    return { state: "REVOKED" as const };
  });

  if (result.state === "NOT_FOUND") return apiError("NOT_FOUND", 404);
  if (result.state === "NOT_ACTIVE" || result.state === "CONFLICT") {
    return apiError("CONFLICT", 409);
  }

  return Response.json(
    { data: { id: grantId, status: "REVOKED" }, correlationId },
    { headers: { "Cache-Control": "no-store" } },
  );
}
