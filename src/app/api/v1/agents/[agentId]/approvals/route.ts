import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { prisma } from "@/lib/prisma";
import { getAgentAccess } from "@/modules/agents/access";
import { canApproveAgentActions } from "@/modules/approvals/access";
import { encryptApprovalPayload } from "@/modules/approvals/payload-vault";
import { lockAgentRuntime, lockGrantRows } from "@/modules/runtime/locks";
import {
  createSafeApprovalPreview,
  digestApprovalEnvelope,
  digestApprovalPayload,
  isApprovalPayloadReviewable,
} from "@/modules/approvals/digest";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ agentId: string }> };

const approvalRequestSchema = z.object({
  grantId: z.string().min(1).max(128),
  actionType: z.string().regex(/^[A-Z][A-Z0-9_.:-]{1,99}$/),
  recipient: z.string().trim().min(1).max(512),
  requestedDataScope: z.array(z.string().trim().min(1).max(128)).min(1).max(20)
    .refine((items) => new Set(items).size === items.length),
  payload: z.record(z.string(), z.unknown()),
  expiresInMinutes: z.number().int().min(1).max(1440).default(30),
  idempotencyKey: z.string().trim().min(8).max(128),
});

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);

  const { agentId } = await context.params;
  const access = await getAgentAccess(agentId, session.user.id);
  if (!access?.canManagePermissions) return apiError("FORBIDDEN", 403);
  const canApprove = await canApproveAgentActions(agentId, session.user.id);

  const approvals = await prisma.actionApproval.findMany({
    where: canApprove
      ? { agentId }
      : { agentId, requesterUserId: session.user.id },
    select: {
      id: true,
      actionType: true,
      recipient: true,
      requestedDataScope: true,
      payloadDigest: true,
      payloadPreview: true,
      status: true,
      expiresAt: true,
      approvedAt: true,
      rejectedAt: true,
      consumedAt: true,
      decisionReason: true,
      createdAt: true,
      requester: { select: { id: true, name: true } },
      approver: { select: { id: true, name: true } },
      grant: {
        select: {
          purpose: true,
          actionScope: true,
          targetScope: true,
          dataScope: true,
          expiresAt: true,
          maxUses: true,
          uses: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return Response.json(
    { data: approvals },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request, context: RouteContext) {
  if (!(await isTrustedMutationRequest(request))) return apiError("INVALID_ORIGIN", 403);

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);

  const { agentId } = await context.params;
  const access = await getAgentAccess(agentId, session.user.id);
  if (!access?.canManagePermissions) return apiError("FORBIDDEN", 403);

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return apiError("INVALID_JSON", 400);
  }
  const parsed = approvalRequestSchema.safeParse(input);
  if (!parsed.success) {
    return apiError("VALIDATION_FAILED", 422, parsed.error.flatten());
  }

  let payloadDigest: string;
  let payloadPreview: ReturnType<typeof createSafeApprovalPreview>;
  if (!isApprovalPayloadReviewable(parsed.data.payload)) {
    return apiError("VALIDATION_FAILED", 422);
  }
  try {
    payloadDigest = digestApprovalPayload(parsed.data.payload);
    payloadPreview = createSafeApprovalPreview(parsed.data.payload);
  } catch {
    return apiError("VALIDATION_FAILED", 422);
  }

  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      ownerType: true,
      userOwnerId: true,
      organizationOwnerId: true,
      status: true,
    },
  });
  if (!agent) return apiError("NOT_FOUND", 404);
  if (agent.status !== "ACTIVE") return apiError("CONFLICT", 409);
  if (
    (agent.ownerType === "USER" && agent.userOwnerId !== session.user.id) ||
    (agent.ownerType === "ORGANIZATION" && !agent.organizationOwnerId)
  ) {
    return apiError("FORBIDDEN", 403);
  }

  const now = new Date();
  const requestedExpiry = new Date(now.getTime() + parsed.data.expiresInMinutes * 60_000);
  const ownerId = agent.ownerType === "USER" ? agent.userOwnerId : agent.organizationOwnerId;
  if (!ownerId) return apiError("CONFLICT", 409);

  const result = await prisma.$transaction(async (tx) => {
    const currentAgent = await tx.agent.findUnique({
      where: { id: agentId },
      select: { status: true, ownerType: true, userOwnerId: true, organizationOwnerId: true },
    });
    if (!currentAgent) return { state: "GRANT_NOT_FOUND" as const };
    if (
      currentAgent.status !== "ACTIVE" ||
      currentAgent.ownerType !== agent.ownerType ||
      currentAgent.userOwnerId !== agent.userOwnerId ||
      currentAgent.organizationOwnerId !== agent.organizationOwnerId
    ) {
      return { state: "AGENT_INACTIVE" as const };
    }

    const requesterAuthorized = currentAgent.ownerType === "USER"
      ? currentAgent.userOwnerId === session.user.id
      : Boolean(currentAgent.organizationOwnerId && await tx.membership.findFirst({
          where: {
            organizationId: currentAgent.organizationOwnerId,
            userId: session.user.id,
            role: { in: ["OWNER", "ADMIN"] },
          },
          select: { id: true },
        }));
    if (!requesterAuthorized) return { state: "FORBIDDEN" as const };

    await lockAgentRuntime(tx, agentId);
    const lockedAgent = await tx.agent.findUnique({
      where: { id: agentId },
      select: { status: true, ownerType: true, userOwnerId: true, organizationOwnerId: true },
    });
    if (
      !lockedAgent ||
      lockedAgent.status !== "ACTIVE" ||
      lockedAgent.ownerType !== currentAgent.ownerType ||
      lockedAgent.userOwnerId !== currentAgent.userOwnerId ||
      lockedAgent.organizationOwnerId !== currentAgent.organizationOwnerId
    ) return { state: "AGENT_INACTIVE" as const };

    await lockGrantRows(tx, [parsed.data.grantId]);
    const expiredApprovals = await tx.actionApproval.findMany({
      where: {
        grantId: parsed.data.grantId,
        status: { in: ["PENDING", "APPROVED"] },
        expiresAt: { lte: now },
        usageReserved: true,
      },
      select: { id: true, version: true },
    });
    if (expiredApprovals.length > 0) {
      const expired = await tx.actionApproval.updateMany({
        where: {
          id: { in: expiredApprovals.map((approval) => approval.id) },
          status: { in: ["PENDING", "APPROVED"] },
          usageReserved: true,
          expiresAt: { lte: now },
        },
        data: {
          status: "EXPIRED",
          usageReserved: false,
          decisionReason: "APPROVAL_EXPIRED",
          version: { increment: 1 },
        },
      });
      if (expired.count !== expiredApprovals.length) {
        throw new Error("APPROVAL_EXPIRY_RESERVATION_CONFLICT");
      }
      const released = await tx.permissionGrant.updateMany({
        where: {
          id: parsed.data.grantId,
          agentId,
          reservedUses: { gte: expiredApprovals.length },
        },
        data: { reservedUses: { decrement: expiredApprovals.length } },
      });
      if (released.count !== 1) throw new Error("APPROVAL_USAGE_RESERVATION_MISSING");
      for (const approval of expiredApprovals) {
        await tx.auditEvent.create({
          data: {
            actorUserId: session.user.id,
            agentId,
            ownerType: currentAgent.ownerType,
            ownerId,
            action: "action_approval.expired",
            targetType: "ActionApproval",
            targetId: approval.id,
            outcome: "FAILED",
            policyVersion: String(approval.version + 1),
            correlationId: randomUUID(),
            metadata: { reason: "APPROVAL_EXPIRED" },
          },
        });
      }
    }
    const existing = await tx.actionApproval.findUnique({
      where: { idempotencyKey: parsed.data.idempotencyKey },
      select: {
        id: true,
        agentId: true,
        requesterUserId: true,
        grantId: true,
        actionType: true,
        recipient: true,
        payloadDigest: true,
        requestedDataScope: true,
        status: true,
      },
    });
    if (existing) {
      const sameRequest =
        existing.agentId === agentId &&
        existing.requesterUserId === session.user.id &&
        existing.grantId === parsed.data.grantId &&
        existing.actionType === parsed.data.actionType &&
        existing.recipient === parsed.data.recipient &&
        existing.payloadDigest === payloadDigest &&
        [...existing.requestedDataScope].sort().join("|") ===
          [...parsed.data.requestedDataScope].sort().join("|");
      return sameRequest
        ? { state: "EXISTING" as const, id: existing.id, status: existing.status }
        : { state: "IDEMPOTENCY_CONFLICT" as const };
    }

    const grant = await tx.permissionGrant.findFirst({
      where: { id: parsed.data.grantId, agentId },
      select: {
        id: true,
        version: true,
        actionScope: true,
        targetScope: true,
        dataScope: true,
        expiresAt: true,
        maxUses: true,
        uses: true,
        reservedUses: true,
        status: true,
        revokedAt: true,
      },
    });
    if (!grant) return { state: "GRANT_NOT_FOUND" as const };
    if (
      grant.status !== "ACTIVE" ||
      grant.revokedAt !== null ||
      grant.expiresAt <= now ||
      (grant.maxUses !== null && grant.uses + grant.reservedUses >= grant.maxUses)
    ) {
      return { state: "GRANT_INACTIVE" as const };
    }
    if (
      !grant.actionScope.includes(parsed.data.actionType) ||
      !grant.targetScope.includes(parsed.data.recipient) ||
      !parsed.data.requestedDataScope.every((scope) => grant.dataScope.includes(scope))
    ) {
      return { state: "GRANT_SCOPE_DENIED" as const };
    }

    const expiresAt = requestedExpiry < grant.expiresAt ? requestedExpiry : grant.expiresAt;
    if (expiresAt <= now) return { state: "GRANT_INACTIVE" as const };

    const approvalId = randomUUID();
    const approvalDigest = digestApprovalEnvelope({
      approvalId,
      agentId,
      grantId: grant.id,
      grantVersion: grant.version,
      requesterUserId: session.user.id,
      actionType: parsed.data.actionType,
      recipient: parsed.data.recipient,
      requestedDataScope: parsed.data.requestedDataScope,
      payloadDigest,
      expiresAt,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    let encryptedPayload: ReturnType<typeof encryptApprovalPayload>;
    try {
      encryptedPayload = encryptApprovalPayload(parsed.data.payload, {
        approvalId,
        agentId,
        grantId: grant.id,
        payloadDigest,
      });
    } catch {
      return { state: "PAYLOAD_VAULT_UNAVAILABLE" as const };
    }

    const inserted = await tx.actionApproval.createMany({
      data: [{
        id: approvalId,
        agentId,
        organizationId: currentAgent.organizationOwnerId,
        grantId: grant.id,
        grantVersion: grant.version,
        requesterUserId: session.user.id,
        actionType: parsed.data.actionType,
        recipient: parsed.data.recipient,
        requestedDataScope: parsed.data.requestedDataScope,
        payloadDigest,
        approvalDigest,
        payloadPreview: payloadPreview as Prisma.InputJsonValue,
        ...encryptedPayload,
        usageReserved: true,
        idempotencyKey: parsed.data.idempotencyKey,
        expiresAt,
      }],
      skipDuplicates: true,
    });
    if (inserted.count === 0) {
      const duplicate = await tx.actionApproval.findUnique({
        where: { idempotencyKey: parsed.data.idempotencyKey },
        select: {
          id: true,
          agentId: true,
          requesterUserId: true,
          grantId: true,
          actionType: true,
          recipient: true,
          requestedDataScope: true,
          payloadDigest: true,
          status: true,
        },
      });
      if (!duplicate) return { state: "IDEMPOTENCY_CONFLICT" as const };
      const sameRequest =
        duplicate.agentId === agentId &&
        duplicate.requesterUserId === session.user.id &&
        duplicate.grantId === parsed.data.grantId &&
        duplicate.actionType === parsed.data.actionType &&
        duplicate.recipient === parsed.data.recipient &&
        duplicate.payloadDigest === payloadDigest &&
        [...duplicate.requestedDataScope].sort().join("|") ===
          [...parsed.data.requestedDataScope].sort().join("|");
      return sameRequest
        ? { state: "EXISTING" as const, id: duplicate.id, status: duplicate.status }
        : { state: "IDEMPOTENCY_CONFLICT" as const };
    }

    const reserved = await tx.permissionGrant.updateMany({
      where: {
        id: grant.id,
        agentId,
        status: "ACTIVE",
        version: grant.version,
        reservedUses: grant.reservedUses,
      },
      data: { reservedUses: { increment: 1 } },
    });
    if (reserved.count !== 1) throw new Error("GRANT_USAGE_RESERVATION_CONFLICT");

    const created = await tx.actionApproval.findUniqueOrThrow({
      where: { id: approvalId },
      select: {
        id: true,
        actionType: true,
        recipient: true,
        requestedDataScope: true,
        payloadDigest: true,
        payloadPreview: true,
        status: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    await tx.auditEvent.create({
      data: {
        actorUserId: session.user.id,
        agentId,
        ownerType: agent.ownerType,
        ownerId,
        action: "action_approval.requested",
        targetType: "ActionApproval",
        targetId: created.id,
        outcome: "COMPLETED",
        policyVersion: "1",
        correlationId: randomUUID(),
        metadata: {
          actionType: created.actionType,
          recipient: created.recipient,
          payloadDigest: created.payloadDigest,
          requestedDataScope: created.requestedDataScope,
          expiresAt: created.expiresAt.toISOString(),
        },
      },
    });

    return { state: "CREATED" as const, approval: created };
  });

  if (result.state === "FORBIDDEN") return apiError("FORBIDDEN", 403);
  if (result.state === "IDEMPOTENCY_CONFLICT") return apiError("CONFLICT", 409);
  if (result.state === "GRANT_NOT_FOUND") return apiError("NOT_FOUND", 404);
  if (result.state === "AGENT_INACTIVE") return apiError("CONFLICT", 409);
  if (result.state === "GRANT_INACTIVE") return apiError("CONFLICT", 409);
  if (result.state === "GRANT_SCOPE_DENIED") return apiError("FORBIDDEN", 403);
  if (result.state === "PAYLOAD_VAULT_UNAVAILABLE") return apiError("SERVICE_UNAVAILABLE", 503);

  return Response.json(
    result.state === "CREATED"
      ? { data: result.approval }
      : { data: { id: result.id, status: result.status } },
    {
      status: result.state === "CREATED" ? 201 : 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
