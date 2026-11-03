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
  if (!access?.canView) return apiError("FORBIDDEN", 403);

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
  const requestDigest = digestAgentRunRequest(input);
  const existing = await prisma.agentRun.findUnique({
    where: {
      requesterUserId_idempotencyKey: {
        requesterUserId: session.user.id,
        idempotencyKey: input.idempotencyKey,
      },
    },
    select: { id: true, requestDigest: true, status: true, createdAt: true },
  });
  if (existing) {
    if (existing.requestDigest !== requestDigest) return apiError("CONFLICT", 409);
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
      },
    }),
  ]);

  const declared = new Set(capabilities.map((capability) => capability.key));
  const eligibleGrants = grants.filter((grant) =>
    (grant.maxUses === null || grant.uses < grant.maxUses) &&
    grant.dataScope.includes("PUBLIC_PROFILE")
  );
  const allowed = new Set<string>();
  for (const grant of eligibleGrants) {
    if (grant.actionScope.includes("DISCOVER_INTERNAL") && declared.has("READ_PUBLIC_PROFILE")) {
      allowed.add("READ_PUBLIC_PROFILE");
    }
    if (grant.actionScope.includes("SEARCH_PUBLIC_WEB") && declared.has("SEARCH_PUBLIC_WEB")) {
      allowed.add("SEARCH_PUBLIC_WEB");
    }
  }
  const authorizedActions = [...allowed].sort();
  if (authorizedActions.length === 0) return apiError("FORBIDDEN", 403);

  const correlationId = randomUUID();
  try {
    const created = await prisma.$transaction(async (tx) => {
      const run = await tx.agentRun.create({
        data: {
          agentId,
          requesterUserId: session.user.id,
          ownerType: access.ownerType,
          ownerId: access.ownerId,
          task: input.task,
          purpose: input.purpose,
          target: input.target,
          authorizedActions,
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
    if (isUniqueConstraintError(error)) {
      const duplicate = await prisma.agentRun.findUnique({
        where: {
          requesterUserId_idempotencyKey: {
            requesterUserId: session.user.id,
            idempotencyKey: input.idempotencyKey,
          },
        },
        select: { id: true, requestDigest: true, status: true, createdAt: true },
      });
      if (duplicate?.requestDigest === requestDigest) {
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
