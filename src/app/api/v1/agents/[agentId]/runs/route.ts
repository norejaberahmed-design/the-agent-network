import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { prisma } from "@/lib/prisma";
import { getAgentAccess } from "@/modules/agents/access";
import { digestAgentRunRequest, createAgentRunSchema } from "@/modules/runtime/run-contract";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ agentId: string }> };

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: unknown }).code === "P2002";
}

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);

  const { agentId } = await context.params;
  const access = await getAgentAccess(agentId, session.user.id);
  if (!access?.canViewPrivate) return apiError("FORBIDDEN", 403);

  const runs = await prisma.agentRun.findMany({
    where: { agentId },
    select: {
      id: true,
      task: true,
      purpose: true,
      target: true,
      authorizedActions: true,
      status: true,
      attemptCount: true,
      maxAttempts: true,
      errorCode: true,
      planSummary: true,
      planSources: true,
      plannedAt: true,
      steps: {
        orderBy: { ordinal: "asc" },
        select: { stepId: true, ordinal: true, action: true, description: true, input: true, status: true },
      },
      createdAt: true,
      updatedAt: true,
      startedAt: true,
      completedAt: true,
      cancelledAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return Response.json({ data: runs }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: RouteContext) {
  if (!(await isTrustedMutationRequest(request))) return apiError("INVALID_ORIGIN", 403);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return apiError("UNAUTHENTICATED", 401);

  const { agentId } = await context.params;
  const access = await getAgentAccess(agentId, session.user.id);
  if (!access?.canManage) return apiError("FORBIDDEN", 403);
  if (access.agent.status !== "ACTIVE") return apiError("CONFLICT", 409);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return apiError("INVALID_JSON", 400);
  }

  const parsed = createAgentRunSchema.safeParse(payload);
  if (!parsed.success) return apiError("VALIDATION_FAILED", 422, parsed.error.flatten());

  const input = parsed.data;
  const requestDigest = digestAgentRunRequest(input, agentId);
  const existing = await prisma.agentRun.findUnique({
    where: {
      requesterUserId_idempotencyKey: {
        requesterUserId: session.user.id,
        idempotencyKey: input.idempotencyKey,
      },
    },
    select: { id: true, agentId: true, requestDigest: true, status: true, createdAt: true },
  });
  if (existing) {
    if (existing.agentId !== agentId || existing.requestDigest !== requestDigest) return apiError("CONFLICT", 409);
    return Response.json(
      { data: existing, idempotentReplay: true, executionEnabled: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const now = new Date();
  const [capabilities, grants] = await Promise.all([
    prisma.agentCapability.findMany({
      where: { agentId },
      select: { key: true },
    }),
    prisma.permissionGrant.findMany({
      where: {
        agentId,
        purpose: input.purpose,
        status: "ACTIVE",
        expiresAt: { gt: now },
        targetScope: { has: input.target },
      },
      select: {
        id: true,
        actionScope: true,
        dataScope: true,
        maxUses: true,
        uses: true,
        reservedUses: true,
      },
    }),
  ]);

  const declared = new Set(capabilities.map((capability) => capability.key));
  const eligibleGrants = grants.filter((grant) =>
    (grant.maxUses === null || grant.uses + grant.reservedUses < grant.maxUses) &&
    grant.dataScope.includes("PUBLIC_PROFILE")
  );
  const allowed = new Set<string>();
  const grantIdsByAction = new Map<string, string[]>();
  for (const grant of eligibleGrants) {
    if (grant.actionScope.includes("DISCOVER_INTERNAL") && declared.has("READ_PUBLIC_PROFILE")) {
      allowed.add("READ_PUBLIC_PROFILE");
      if (!grantIdsByAction.has("READ_PUBLIC_PROFILE")) grantIdsByAction.set("READ_PUBLIC_PROFILE", [grant.id]);
    }
    if (grant.actionScope.includes("SEARCH_PUBLIC_WEB") && declared.has("SEARCH_PUBLIC_WEB")) {
      allowed.add("SEARCH_PUBLIC_WEB");
      if (!grantIdsByAction.has("SEARCH_PUBLIC_WEB")) grantIdsByAction.set("SEARCH_PUBLIC_WEB", [grant.id]);
    }
  }
  const authorizedActions = [...allowed].sort();
  const selectedGrantIds = [...new Set(authorizedActions.flatMap((action) => grantIdsByAction.get(action) ?? []))].sort();
  if (authorizedActions.length === 0 || selectedGrantIds.length === 0) return apiError("FORBIDDEN", 403);

  const correlationId = randomUUID();
  try {
    const created = await prisma.$transaction(async (tx) => {
      const activeAgent = await tx.agent.findFirst({
        where: { id: agentId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!activeAgent) throw new Error("AGENT_NOT_ACTIVE");
      if (access.ownerType === "ORGANIZATION") {
        const membership = await tx.membership.findUnique({
          where: { organizationId_userId: { organizationId: access.ownerId, userId: session.user.id } },
          select: { role: true },
        });
        if (!membership || !["OWNER", "ADMIN", "AGENT_MANAGER"].includes(membership.role)) {
          throw new Error("ACCESS_REVOKED");
        }
      }
      for (const grantId of selectedGrantIds) {
        const currentGrant = await tx.permissionGrant.findFirst({
          where: {
            id: grantId,
            agentId,
            purpose: input.purpose,
            targetScope: { has: input.target },
            dataScope: { has: "PUBLIC_PROFILE" },
            status: "ACTIVE",
            expiresAt: { gt: now },
          },
          select: { uses: true, reservedUses: true, maxUses: true, version: true },
        });
        if (!currentGrant || (
          currentGrant.maxUses !== null &&
          currentGrant.uses + currentGrant.reservedUses >= currentGrant.maxUses
        )) throw new Error("GRANT_RESERVATION_CONFLICT");

        const reserved = await tx.permissionGrant.updateMany({
          where: {
            id: grantId,
            uses: currentGrant.uses,
            reservedUses: currentGrant.reservedUses,
            version: currentGrant.version,
            status: "ACTIVE",
            expiresAt: { gt: now },
          },
          data: { reservedUses: { increment: 1 } },
        });
        if (reserved.count !== 1) throw new Error("GRANT_RESERVATION_CONFLICT");
      }

      const run = await tx.agentRun.create({
        data: {
          agentId,
          requesterUserId: session.user.id,
          ownerType: access.ownerType,
          ownerId: access.ownerId,
          agentConfigurationVersion: access.agent.configurationVersion,
          task: input.task,
          purpose: input.purpose,
          target: input.target,
          authorizedActions,
          grantIds: selectedGrantIds,
          requestDigest,
          idempotencyKey: input.idempotencyKey,
          status: "QUEUED",
          maxAttempts: 3,
        },
        select: {
          id: true,
          task: true,
          purpose: true,
          target: true,
          authorizedActions: true,
          status: true,
          attemptCount: true,
          maxAttempts: true,
          createdAt: true,
        },
      });

      await tx.auditEvent.create({
        data: {
          actorUserId: session.user.id,
          agentId,
          ownerType: access.ownerType,
          ownerId: access.ownerId,
          action: "agent.run.queued",
          targetType: "AgentRun",
          targetId: run.id,
          outcome: "ALLOWED",
          policyVersion: String(access.agent.configurationVersion),
          correlationId,
          metadata: {
            authorizedActionCount: authorizedActions.length,
            reservedGrantCount: selectedGrantIds.length,
            target: input.target,
            status: "QUEUED",
          },
        },
      });
      return run;
    });

    return Response.json(
      { data: created, correlationId, executionEnabled: false },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "GRANT_RESERVATION_CONFLICT") {
      return apiError("CONFLICT", 409);
    }
    if (error instanceof Error && error.message === "AGENT_NOT_ACTIVE") return apiError("CONFLICT", 409);
    if (error instanceof Error && error.message === "ACCESS_REVOKED") return apiError("FORBIDDEN", 403);
    if (isUniqueConstraintError(error)) {
      const duplicate = await prisma.agentRun.findUnique({
        where: {
          requesterUserId_idempotencyKey: {
            requesterUserId: session.user.id,
            idempotencyKey: input.idempotencyKey,
          },
        },
        select: { id: true, agentId: true, requestDigest: true, status: true, createdAt: true },
      });
      if (duplicate?.agentId === agentId && duplicate.requestDigest === requestDigest) {
        return Response.json(
          { data: duplicate, idempotentReplay: true, executionEnabled: false },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      return apiError("CONFLICT", 409);
    }
    return apiError("INTERNAL_ERROR", 500);
  }
}
