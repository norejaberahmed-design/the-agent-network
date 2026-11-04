import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { prisma } from "@/lib/prisma";
import { getAgentAccess } from "@/modules/agents/access";
import { lockAgentRuntime } from "@/modules/runtime/locks";

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
  const now = new Date();
  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockAgentRuntime(tx, agentId);
      if (access.ownerType === "ORGANIZATION") {
        const membership = await tx.membership.findUnique({
          where: { organizationId_userId: { organizationId: access.ownerId, userId: session.user.id } },
          select: { role: true },
        });
        if (!membership || !["OWNER", "ADMIN", "AGENT_MANAGER"].includes(membership.role)) {
          throw new Error("ACCESS_REVOKED");
        }
      } else if (access.ownerId !== session.user.id) {
        throw new Error("ACCESS_REVOKED");
      }
      const changed = await tx.agentRun.updateMany({
        where: { id: runId, agentId, status: "PLANNED" },
        data: {
          status: "CANCELLED",
          cancelledAt: now,
          completedAt: now,
          errorCode: "OWNER_REJECTED_PLAN",
        },
      });
      if (changed.count !== 1) throw new Error("PLAN_NOT_REVIEWABLE");

      await tx.agentRunStep.updateMany({
        where: { runId, status: "PROPOSED" },
        data: { status: "REJECTED" },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId: session.user.id,
          agentId,
          ownerType: access.ownerType,
          ownerId: access.ownerId,
          action: "agent.run.plan_rejected",
          targetType: "AgentRun",
          targetId: runId,
          outcome: "COMPLETED",
          policyVersion: String(access.agent.configurationVersion),
          correlationId,
          metadata: { reason: "OWNER_REJECTED_PLAN" },
        },
      });
      return { id: runId, status: "CANCELLED" as const };
    });

    return Response.json({ data: result, correlationId }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ACCESS_REVOKED") return apiError("FORBIDDEN", 403);
    if (error instanceof Error && error.message === "PLAN_NOT_REVIEWABLE") {
      return apiError("CONFLICT", 409);
    }
    return apiError("INTERNAL_ERROR", 500);
  }
}
