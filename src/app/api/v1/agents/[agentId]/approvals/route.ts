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
import {
  createSafeApprovalPreview,
  digestApprovalEnvelope,
  digestApprovalPayload,
} from "@/modules/approvals/digest";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ agentId: string }> };

const approvalRequestSchema = z.object({
  grantId: z.string().min(1).max(128),
  actionType: z.string().regex(/^[A-Z][A-Z0-9_.:-]{1,99}$/),
  recipient: z.string().trim().min(1).max(512),
  requestedDataScope: z.array(z.string().trim().min(1).max(128)).min(1).max(20)
    .refine((items) => new Set(items).size === items.length),
  payload: z.record(z.unknown()),
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
    },
  });
  if (!agent) return apiError("NOT_FOUND", 404);
  if (agent.ownerType !== "ORGANIZATION" || !agent.organizationOwnerId) {
    return apiError("FORBIDDEN", 403);
  }

  const now = new Date();
  const requestedExpiry = new Date(now.getTime() + parsed.data.expiresInMinutes * 60_000);
  const ownerId = agent.ownerType === "USER"
    ? agent.userOwnerId
    : agent.organizationOwnerId;
  if (!ownerId) return apiError("CONFLICT", 409);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.actionApproval.findUnique({
      where: { idempotencyKey: parsed.data.idempotencyKey },
      select: {
        id: true,
        agentId: true,
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
        actionScope: true,
        targetScope: true,
        dataScope: true,
        expiresAt: true,
        maxUses: true,
        uses: true,
        status: true,
        revokedAt: true,
      },
    });
    if (!grant) return { state: "GRANT_NOT_FOUND" as const };
    if (
      grant.status !== "ACTIVE" ||
      grant.revokedAt !== null ||
      grant.expiresAt <= now ||
      (grant.maxUses !== null && grant.uses >= grant.maxUses)
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
      requesterUserId: session.user.id,
      actionType: parsed.data.actionType,
      recipient: parsed.data.recipient,
      requestedDataScope: parsed.data.requestedDataScope,
      payloadDigest,
      expiresAt,
      idempotencyKey: parsed.data.idempotencyKey,
    });

    const created = await tx.actionApproval.create({
      data: {
        id: approvalId,
        agentId,
        organizationId: agent.organizationOwnerId,
        grantId: grant.id,
        requesterUserId: session.user.id,
        actionType: parsed.data.actionType,
        recipient: parsed.data.recipient,
        requestedDataScope: parsed.data.requestedDataScope,
        payloadDigest,
        approvalDigest,
        payloadPreview: payloadPreview as Prisma.InputJsonValue,
        idempotencyKey: parsed.data.idempotencyKey,
        expiresAt,
      },
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

  if (result.state === "IDEMPOTENCY_CONFLICT") return apiError("CONFLICT", 409);
  if (result.state === "GRANT_NOT_FOUND") return apiError("NOT_FOUND", 404);
  if (result.state === "GRANT_INACTIVE") return apiError("CONFLICT", 409);
  if (result.state === "GRANT_SCOPE_DENIED") return apiError("FORBIDDEN", 403);

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
