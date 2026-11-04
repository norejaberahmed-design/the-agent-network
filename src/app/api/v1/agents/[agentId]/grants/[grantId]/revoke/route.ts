import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { prisma } from "@/lib/prisma";
import { getAgentAccess } from "@/modules/agents/access";
import { lockAgentRuntime, lockGrantRows } from "@/modules/runtime/locks";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ agentId: string; grantId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  if (!(await isTrustedMutationRequest(request))) return apiError("INVALID_ORIGIN", 403);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);

  const { agentId, grantId } = await context.params;
  const access = await getAgentAccess(agentId, session.user.id);
  if (!access?.canManagePermissions) return apiError("FORBIDDEN", 403);

  const correlationId = randomUUID();
  const result = await prisma.$transaction(async (tx) => {
    await lockAgentRuntime(tx, agentId);
    if (access.ownerType === "ORGANIZATION") {
      const membership = await tx.membership.findUnique({
        where: { organizationId_userId: { organizationId: access.ownerId, userId: session.user.id } },
        select: { role: true },
      });
      if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
        return { state: "ACCESS_REVOKED" as const };
      }
    } else if (access.ownerId !== session.user.id) {
      return { state: "ACCESS_REVOKED" as const };
    }
    const grant = await tx.permissionGrant.findFirst({
      where: { id: grantId, agentId },
      select: { id: true, status: true, version: true },
    });
    if (!grant) return { state: "NOT_FOUND" as const };

    if (grant.status !== "ACTIVE") return { state: "NOT_ACTIVE" as const };

    const queuedRuns = await tx.agentRun.findMany({
      where: { agentId, status: { in: ["QUEUED", "PLANNING"] }, grantIds: { has: grantId } },
      select: { id: true, grantIds: true },
    });
    await lockGrantRows(tx, [grantId, ...queuedRuns.flatMap((run) => run.grantIds)]);
    const currentGrant = await tx.permissionGrant.findFirst({
      where: { id: grantId, agentId, status: "ACTIVE" },
      select: { id: true, version: true },
    });
    if (!currentGrant) return { state: "CONFLICT" as const };

    const changed = await tx.permissionGrant.updateMany({
      where: { id: grantId, agentId, status: "ACTIVE", version: currentGrant.version },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) return { state: "CONFLICT" as const };
    const affectedApprovals = await tx.actionApproval.findMany({
      where: {
        grantId,
        status: { in: ["PENDING", "APPROVED"] },
      },
      select: { id: true, status: true, version: true },
    });
    const cancelledApprovals = await tx.actionApproval.updateMany({
      where: {
        grantId,
        status: { in: ["PENDING", "APPROVED"] },
      },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        decisionReason: "GRANT_REVOKED",
        version: { increment: 1 },
      },
    });
    if (cancelledApprovals.count !== affectedApprovals.length) {
      throw new Error("APPROVAL_REVOCATION_CONFLICT");
    }
    for (const approval of affectedApprovals) {
      await tx.auditEvent.create({
        data: {
          actorUserId: session.user.id,
          agentId,
          ownerType: access.ownerType,
          ownerId: access.ownerId,
          action: "action_approval.cancelled",
          targetType: "ActionApproval",
          targetId: approval.id,
          outcome: "DENIED",
          policyVersion: String(approval.version + 1),
          correlationId,
          metadata: { reason: "GRANT_REVOKED", previousStatus: approval.status },
        },
      });
    }

    for (const run of queuedRuns) {
      const cancelled = await tx.agentRun.updateMany({
        where: { id: run.id, agentId, status: { in: ["QUEUED", "PLANNING"] } },
        data: { status: "CANCELLED", cancelledAt: new Date(), errorCode: "GRANT_REVOKED", workerId: null, claimedAt: null, leaseExpiresAt: null },
      });
      if (cancelled.count !== 1) continue;
      for (const reservedGrantId of run.grantIds) {
        const released = await tx.permissionGrant.updateMany({
          where: { id: reservedGrantId, agentId, reservedUses: { gt: 0 } },
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
          targetId: run.id,
          outcome: "COMPLETED",
          policyVersion: String(currentGrant.version + 1),
          correlationId,
          metadata: { reason: "GRANT_REVOKED", releasedGrantReservations: run.grantIds.length },
        },
      });
    }

    await tx.agent.update({
      where: { id: agentId },
      data: { configurationVersion: { increment: 1 } },
    });

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

  if (result.state === "ACCESS_REVOKED") return apiError("FORBIDDEN", 403);
  if (result.state === "NOT_FOUND") return apiError("NOT_FOUND", 404);
  if (result.state === "NOT_ACTIVE" || result.state === "CONFLICT") {
    return apiError("CONFLICT", 409);
  }

  return Response.json(
    { data: { id: grantId, status: "REVOKED" }, correlationId },
    { headers: { "Cache-Control": "no-store" } },
  );
}
