import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { prisma } from "@/lib/prisma";
import { getAgentAccess } from "@/modules/agents/access";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ agentId: string; runId: string }> };

export async function POST(request: Request, context: RouteContext) {
  if (!(await isTrustedMutationRequest(request))) return apiError("INVALID_ORIGIN", 403);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);

  const { agentId, runId } = await context.params;
  const access = await getAgentAccess(agentId, session.user.id);
  if (!access?.canManage) return apiError("FORBIDDEN", 403);

  const correlationId = randomUUID();
  try {
    const cancelled = await prisma.$transaction(async (tx) => {
      const run = await tx.agentRun.findFirst({
        where: { id: runId, agentId },
        select: { id: true, status: true, grantIds: true },
      });
      if (!run) return null;
      if (run.status !== "QUEUED") throw new Error("RUN_NOT_CANCELLABLE");

      const changed = await tx.agentRun.updateMany({
        where: { id: runId, agentId, status: "QUEUED" },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      if (changed.count !== 1) throw new Error("RUN_NOT_CANCELLABLE");

      for (const grantId of run.grantIds) {
        const released = await tx.permissionGrant.updateMany({
          where: { id: grantId, agentId, reservedUses: { gt: 0 } },
          data: { reservedUses: { decrement: 1 } },
        });
        if (released.count !== 1) throw new Error("GRANT_RESERVATION_MISSING");
      }

      await tx.auditEvent.create({
        data: {
          actorUserId: session.user.id,
          agentId,
          ownerType: access.ownerType,
          ownerId: access.ownerId,
          action: "agent.run.cancelled",
          targetType: "AgentRun",
          targetId: runId,
          outcome: "COMPLETED",
          policyVersion: String(access.agent.configurationVersion),
          correlationId,
          metadata: { releasedGrantReservations: run.grantIds.length },
        },
      });
      return { id: runId, status: "CANCELLED" as const };
    });

    if (!cancelled) return apiError("NOT_FOUND", 404);
    return Response.json(
      { data: cancelled, correlationId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof Error && (
      error.message === "RUN_NOT_CANCELLABLE" ||
      error.message === "GRANT_RESERVATION_MISSING"
    )) return apiError("CONFLICT", 409);
    return apiError("INTERNAL_ERROR", 500);
  }
}
