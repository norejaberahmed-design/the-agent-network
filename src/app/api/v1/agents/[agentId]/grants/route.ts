import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { prisma } from "@/lib/prisma";
import { getAgentAccess } from "@/modules/agents/access";
import { createPermissionGrantSchema } from "@/modules/permissions/contract";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ agentId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);

  const { agentId } = await context.params;
  const access = await getAgentAccess(agentId, session.user.id);
  if (!access?.canView) return apiError("FORBIDDEN", 403);

  const grants = await prisma.permissionGrant.findMany({
    where: { agentId },
    select: {
      id: true,
      purpose: true,
      actionScope: true,
      targetScope: true,
      dataScope: true,
      expiresAt: true,
      maxUses: true,
      uses: true,
      version: true,
      status: true,
      createdAt: true,
      revokedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return Response.json({ data: grants }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: RouteContext) {
  if (!isTrustedMutationRequest(request)) return apiError("INVALID_ORIGIN", 403);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);

  const { agentId } = await context.params;
  const access = await getAgentAccess(agentId, session.user.id);
  if (!access?.canManage) return apiError("FORBIDDEN", 403);
  if (access.agent.status === "SUSPENDED" || access.agent.status === "REVOKED") {
    return apiError("FORBIDDEN", 403);
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return apiError("INVALID_JSON", 400);
  }

  const parsed = createPermissionGrantSchema.safeParse(input);
  if (!parsed.success) return apiError("VALIDATION_FAILED", 422, parsed.error.flatten());

  const expiresAt = new Date(parsed.data.expiresAt);
  const now = new Date();
  const maxExpiry = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  if (expiresAt <= now || expiresAt > maxExpiry) {
    return apiError("VALIDATION_FAILED", 422, {
      expiresAt: ["Expiry must be in the future and no more than 90 days away."],
    });
  }

  const correlationId = randomUUID();
  const grant = await prisma.$transaction(async (tx) => {
    const created = await tx.permissionGrant.create({
      data: {
        agentId,
        purpose: parsed.data.purpose,
        actionScope: parsed.data.actionScope,
        targetScope: parsed.data.targetScope,
        dataScope: parsed.data.dataScope,
        expiresAt,
        maxUses: parsed.data.maxUses ?? null,
      },
      select: {
        id: true,
        purpose: true,
        actionScope: true,
        targetScope: true,
        dataScope: true,
        expiresAt: true,
        maxUses: true,
        uses: true,
        version: true,
        status: true,
        createdAt: true,
      },
    });

    await tx.auditEvent.create({
      data: {
        actorUserId: session.user.id,
        agentId,
        ownerType: access.ownerType,
        ownerId: access.ownerId,
        action: "permission_grant.created",
        targetType: "PermissionGrant",
        targetId: created.id,
        outcome: "COMPLETED",
        policyVersion: String(created.version),
        correlationId,
        metadata: {
          actionScope: created.actionScope,
          targetScope: created.targetScope,
          dataScope: created.dataScope,
          expiresAt: created.expiresAt.toISOString(),
        },
      },
    });
    return created;
  });

  return Response.json(
    { data: grant, correlationId, executionEnabled: false },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
