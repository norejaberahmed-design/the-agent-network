import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { prisma } from "@/lib/prisma";
import { canApproveAgentActions } from "@/modules/approvals/access";
import { digestApprovalEnvelope } from "@/modules/approvals/digest";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ approvalId: string }> };

const decisionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().trim().max(500).optional(),
});

export async function PATCH(request: Request, context: RouteContext) {
  if (!(await isTrustedMutationRequest(request))) return apiError("INVALID_ORIGIN", 403);

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return apiError("INVALID_JSON", 400);
  }
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) {
    return apiError("VALIDATION_FAILED", 422, parsed.error.flatten());
  }

  const { approvalId } = await context.params;
  const approvalForAccess = await prisma.actionApproval.findUnique({
    where: { id: approvalId },
    select: { agentId: true, requesterUserId: true },
  });
  if (!approvalForAccess) return apiError("NOT_FOUND", 404);
  if (approvalForAccess.requesterUserId === session.user.id) {
    return apiError("FORBIDDEN", 403);
  }
  if (!(await canApproveAgentActions(approvalForAccess.agentId, session.user.id))) {
    return apiError("FORBIDDEN", 403);
  }

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const approval = await tx.actionApproval.findUnique({
      where: { id: approvalId },
      select: {
        id: true,
        agentId: true,
        grantId: true,
        organizationId: true,
        requesterUserId: true,
        actionType: true,
        recipient: true,
        requestedDataScope: true,
        payloadDigest: true,
        approvalDigest: true,
        idempotencyKey: true,
        status: true,
        expiresAt: true,
        version: true,
        agent: {
          select: {
            ownerType: true,
            userOwnerId: true,
            organizationOwnerId: true,
            status: true,
          },
        },
        grant: {
          select: {
            agentId: true,
            status: true,
            revokedAt: true,
            expiresAt: true,
            actionScope: true,
            targetScope: true,
            dataScope: true,
            maxUses: true,
            uses: true,
          },
        },
      },
    });
    if (!approval) return { state: "NOT_FOUND" as const };
    if (approval.status !== "PENDING") return { state: "CONFLICT" as const };
    if (approval.requesterUserId === session.user.id) {
      return { state: "FORBIDDEN" as const };
    }

    if (
      approval.agent.ownerType !== "ORGANIZATION" ||
      !approval.agent.organizationOwnerId ||
      approval.organizationId !== approval.agent.organizationOwnerId
    ) {
      return { state: "CONFLICT" as const };
    }
    const ownerId = approval.agent.organizationOwnerId;

    const stillAuthorized = Boolean(await tx.membership.findFirst({
      where: {
        organizationId: ownerId,
        userId: session.user.id,
        role: { in: ["OWNER", "ADMIN"] },
      },
      select: { id: true },
    }));
    if (!stillAuthorized) return { state: "FORBIDDEN" as const };

    const expireOrCancel = async (
      status: "EXPIRED" | "CANCELLED",
      reason: string,
      action: string,
    ) => {
      const changed = await tx.actionApproval.updateMany({
        where: {
          id: approval.id,
          status: "PENDING",
          version: approval.version,
        },
        data: {
          status,
          decisionReason: reason,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) return { state: "CONFLICT" as const };

      await tx.auditEvent.create({
        data: {
          actorUserId: session.user.id,
          agentId: approval.agentId,
          ownerType: approval.agent.ownerType,
          ownerId,
          action,
          targetType: "ActionApproval",
          targetId: approval.id,
          outcome: status === "EXPIRED" ? "FAILED" : "DENIED",
          policyVersion: String(approval.version + 1),
          correlationId: randomUUID(),
          metadata: {
            actionType: approval.actionType,
            recipient: approval.recipient,
            payloadDigest: approval.payloadDigest,
            reason,
          },
        },
      });
      return { state: status as "EXPIRED" | "CANCELLED" };
    };

    if (approval.expiresAt <= now) {
      return expireOrCancel("EXPIRED", "APPROVAL_EXPIRED", "action_approval.expired");
    }

    if (approval.agent.status !== "ACTIVE") {
      return expireOrCancel(
        "CANCELLED",
        "AGENT_NOT_ACTIVE",
        "action_approval.cancelled",
      );
    }

    const grant = approval.grant;
    const grantValid =
      grant.agentId === approval.agentId &&
      grant.status === "ACTIVE" &&
      grant.revokedAt === null &&
      grant.expiresAt > now &&
      (grant.maxUses === null || grant.uses < grant.maxUses) &&
      grant.actionScope.includes(approval.actionType) &&
      grant.targetScope.includes(approval.recipient) &&
      approval.requestedDataScope.every((scope) => grant.dataScope.includes(scope));
    if (!grantValid) {
      return expireOrCancel(
        "CANCELLED",
        "GRANT_NO_LONGER_VALID",
        "action_approval.cancelled",
      );
    }

    const expectedDigest = digestApprovalEnvelope({
      approvalId: approval.id,
      agentId: approval.agentId,
      grantId: approval.grantId,
      requesterUserId: approval.requesterUserId,
      actionType: approval.actionType,
      recipient: approval.recipient,
      requestedDataScope: approval.requestedDataScope,
      payloadDigest: approval.payloadDigest,
      expiresAt: approval.expiresAt,
      idempotencyKey: approval.idempotencyKey,
    });
    if (expectedDigest !== approval.approvalDigest) {
      return expireOrCancel(
        "CANCELLED",
        "APPROVAL_DIGEST_MISMATCH",
        "action_approval.cancelled",
      );
    }

    const nextStatus = parsed.data.decision === "APPROVE" ? "APPROVED" : "REJECTED";
    const updated = await tx.actionApproval.updateMany({
      where: {
        id: approval.id,
        status: "PENDING",
        version: approval.version,
        expiresAt: { gt: now },
      },
      data: {
        status: nextStatus,
        approverUserId: session.user.id,
        approvedAt: nextStatus === "APPROVED" ? now : null,
        rejectedAt: nextStatus === "REJECTED" ? now : null,
        decisionReason: parsed.data.reason ?? null,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) return { state: "CONFLICT" as const };

    await tx.auditEvent.create({
      data: {
        actorUserId: session.user.id,
        agentId: approval.agentId,
        ownerType: approval.agent.ownerType,
        ownerId,
        action: nextStatus === "APPROVED"
          ? "action_approval.approved"
          : "action_approval.rejected",
        targetType: "ActionApproval",
        targetId: approval.id,
        outcome: "COMPLETED",
        policyVersion: String(approval.version + 1),
        correlationId: randomUUID(),
        metadata: {
          actionType: approval.actionType,
          recipient: approval.recipient,
          payloadDigest: approval.payloadDigest,
          requestedDataScope: approval.requestedDataScope,
          decision: parsed.data.decision,
        },
      },
    });

    return { state: nextStatus as "APPROVED" | "REJECTED" };
  });

  if (result.state === "NOT_FOUND") return apiError("NOT_FOUND", 404);
  if (result.state === "FORBIDDEN") return apiError("FORBIDDEN", 403);
  if (result.state === "CONFLICT") return apiError("CONFLICT", 409);

  return Response.json(
    { data: { id: approvalId, status: result.state } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
