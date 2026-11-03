import { randomUUID } from "node:crypto";
import { Prisma, type AgentRun, type PrismaClient } from "@prisma/client";
import {
  createAgentPlan,
  type AgentPlanProvider,
  type AgentPlanningRequest,
} from "./planner";
import {
  mayContainChildSexualAbuse,
  safetyIdentifierForUser,
  type TextModerator,
} from "./openai-provider";

type Tx = Prisma.TransactionClient;

export type AgentWorkerResult =
  | { status: "IDLE" }
  | { status: "PLANNED"; runId: string; stepCount: number; sourceCount: number }
  | { status: "CANCELLED"; runId: string; reason: string }
  | { status: "FAILED" | "RETRY_SCHEDULED" | "DEAD_LETTER"; runId: string; code: string }
  | { status: "DISABLED"; reason: "PROVIDER_NOT_CONFIGURED" }
  | { status: "THROTTLED"; reason: "DAILY_RUN_LIMIT" };

type AuthorizationSnapshot = {
  agentName: string;
  agentPurpose: string;
  allowedActions: AgentPlanningRequest["trustedContext"]["allowedActions"];
  configurationVersion: number;
};

async function releaseReservations(tx: Tx, run: Pick<AgentRun, "agentId" | "grantIds">) {
  for (const grantId of run.grantIds) {
    const released = await tx.permissionGrant.updateMany({
      where: { id: grantId, agentId: run.agentId, reservedUses: { gt: 0 } },
      data: { reservedUses: { decrement: 1 } },
    });
    if (released.count !== 1) throw new Error("GRANT_RESERVATION_MISSING");
  }
}

async function validateLiveAuthorization(
  tx: Tx,
  run: AgentRun,
  now: Date,
): Promise<AuthorizationSnapshot | null> {
  if (run.grantIds.length === 0 || run.authorizedActions.length === 0) return null;

  const agent = await tx.agent.findUnique({
    where: { id: run.agentId },
    select: {
      status: true,
      ownerType: true,
      userOwnerId: true,
      organizationOwnerId: true,
      name: true,
      purpose: true,
      configurationVersion: true,
      capabilities: { select: { key: true } },
    },
  });
  if (!agent || agent.status !== "ACTIVE" ||
    agent.configurationVersion !== run.agentConfigurationVersion) return null;

  if (run.ownerType === "USER") {
    if (agent.ownerType !== "USER" || agent.userOwnerId !== run.ownerId ||
      run.requesterUserId !== run.ownerId) return null;
  } else {
    if (agent.ownerType !== "ORGANIZATION" || agent.organizationOwnerId !== run.ownerId) return null;
    const membership = await tx.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: run.ownerId,
          userId: run.requesterUserId,
        },
      },
      select: { role: true },
    });
    if (!membership || !["OWNER", "ADMIN", "AGENT_MANAGER"].includes(membership.role)) return null;
  }

  const grants = await tx.permissionGrant.findMany({
    where: {
      id: { in: run.grantIds },
      agentId: run.agentId,
      purpose: run.purpose,
      targetScope: { has: run.target },
      dataScope: { has: "PUBLIC_PROFILE" },
      status: "ACTIVE",
      expiresAt: { gt: now },
    },
    select: {
      id: true,
      actionScope: true,
      uses: true,
      reservedUses: true,
      maxUses: true,
    },
  });
  if (grants.length !== run.grantIds.length) return null;
  if (grants.some((grant) =>
    grant.reservedUses < 1 ||
    (grant.maxUses !== null && grant.uses + grant.reservedUses > grant.maxUses)
  )) return null;

  const declared = new Set(agent.capabilities.map((capability) => capability.key));
  const granted = new Set<string>();
  for (const grant of grants) {
    if (grant.actionScope.includes("DISCOVER_INTERNAL")) granted.add("READ_PUBLIC_PROFILE");
    if (grant.actionScope.includes("SEARCH_PUBLIC_WEB")) granted.add("SEARCH_PUBLIC_WEB");
  }

  const allowedActions = run.authorizedActions.filter((action) =>
    (action === "READ_PUBLIC_PROFILE" && declared.has(action) && granted.has(action)) ||
    (action === "SEARCH_PUBLIC_WEB" && declared.has(action) && granted.has(action))
  );
  if (allowedActions.length !== run.authorizedActions.length) return null;

  return {
    agentName: agent.name,
    agentPurpose: agent.purpose,
    allowedActions: [...allowedActions, "ASK_OWNER"],
    configurationVersion: agent.configurationVersion,
  };
}

async function claimNextRun(
  prisma: PrismaClient,
  workerId: string,
  now: Date,
): Promise<AgentRun | null> {
  return prisma.$transaction(async (tx) => {
    const expired = await tx.agentRun.findMany({
      where: { status: "PLANNING", leaseExpiresAt: { lte: now } },
      take: 100,
      orderBy: { leaseExpiresAt: "asc" },
    });

    for (const run of expired.filter((item) => item.attemptCount >= item.maxAttempts)) {
      const changed = await tx.agentRun.updateMany({
        where: {
          id: run.id,
          status: "PLANNING",
          leaseExpiresAt: { lte: now },
          attemptCount: run.attemptCount,
        },
        data: {
          status: "DEAD_LETTER",
          errorCode: "WORKER_LEASE_EXHAUSTED",
          workerId: null,
          claimedAt: null,
          leaseExpiresAt: null,
          completedAt: now,
        },
      });
      if (changed.count !== 1) continue;
      await releaseReservations(tx, run);
      await tx.auditEvent.create({
        data: {
          agentId: run.agentId,
          ownerType: run.ownerType,
          ownerId: run.ownerId,
          action: "agent.run.dead_lettered",
          targetType: "AgentRun",
          targetId: run.id,
          outcome: "FAILED",
          policyVersion: String(run.agentConfigurationVersion),
          correlationId: randomUUID(),
          metadata: { reason: "WORKER_LEASE_EXHAUSTED", attemptCount: run.attemptCount },
        },
      });
    }

    const leaseUntil = new Date(now.getTime() + 90_000);
    const sql = [
      'WITH candidate AS (',
      '  SELECT "id" FROM "AgentRun"',
      '  WHERE (("status" = \'QUEUED\' AND "availableAt" <= $1)',
      '     OR ("status" = \'PLANNING\' AND "leaseExpiresAt" <= $2 AND "attemptCount" < "maxAttempts"))',
      '  ORDER BY "availableAt" ASC, "createdAt" ASC',
      '  FOR UPDATE SKIP LOCKED',
      '  LIMIT 1',
      ')',
      'UPDATE "AgentRun" AS run',
      'SET "status" = \'PLANNING\', "workerId" = $3, "claimedAt" = $4,',
      '    "leaseExpiresAt" = $5, "attemptCount" = run."attemptCount" + 1,',
      '    "startedAt" = COALESCE(run."startedAt", $6), "errorCode" = NULL, "updatedAt" = $7',
      'FROM candidate WHERE run."id" = candidate."id"',
      'RETURNING run.*',
    ].join("\n");
    const claimed = await tx.$queryRawUnsafe<AgentRun[]>(
      sql,
      now,
      now,
      workerId,
      now,
      leaseUntil,
      now,
      now,
    );
    return claimed[0] ?? null;
  });
}

async function failRun(
  prisma: PrismaClient,
  run: AgentRun,
  workerId: string,
  code: string,
  retryable: boolean,
  now: Date,
): Promise<AgentWorkerResult> {
  const shouldRetry = retryable && run.attemptCount < run.maxAttempts;
  const terminalStatus = retryable ? "DEAD_LETTER" : "FAILED";
  const nextStatus = shouldRetry ? "QUEUED" : terminalStatus;
  const delayMs = Math.min(60_000 * (2 ** Math.max(0, run.attemptCount - 1)), 15 * 60_000);

  await prisma.$transaction(async (tx) => {
    const changed = await tx.agentRun.updateMany({
      where: { id: run.id, status: "PLANNING", workerId },
      data: {
        status: nextStatus,
        errorCode: code,
        availableAt: shouldRetry ? new Date(now.getTime() + delayMs) : now,
        workerId: null,
        claimedAt: null,
        leaseExpiresAt: null,
        completedAt: shouldRetry ? null : now,
      },
    });
    if (changed.count !== 1) return;

    if (!shouldRetry) await releaseReservations(tx, run);

    await tx.auditEvent.create({
      data: {
        agentId: run.agentId,
        ownerType: run.ownerType,
        ownerId: run.ownerId,
        action: shouldRetry ? "agent.run.retry_scheduled" : "agent.run.failed",
        targetType: "AgentRun",
        targetId: run.id,
        outcome: "FAILED",
        policyVersion: String(run.agentConfigurationVersion),
        correlationId: randomUUID(),
        metadata: {
          errorCode: code,
          attemptCount: run.attemptCount,
          maxAttempts: run.maxAttempts,
          reservationReleased: !shouldRetry,
        },
      },
    });
  });

  if (shouldRetry) return { status: "RETRY_SCHEDULED", runId: run.id, code };
  return { status: retryable ? "DEAD_LETTER" : "FAILED", runId: run.id, code };
}

async function cancelRunForAuthorizationFailure(
  prisma: PrismaClient,
  run: AgentRun,
  workerId: string,
  now: Date,
): Promise<AgentWorkerResult> {
  await prisma.$transaction(async (tx) => {
    const changed = await tx.agentRun.updateMany({
      where: { id: run.id, status: "PLANNING", workerId },
      data: {
        status: "CANCELLED",
        errorCode: "AUTHORIZATION_REVOKED",
        cancelledAt: now,
        workerId: null,
        claimedAt: null,
        leaseExpiresAt: null,
        completedAt: now,
      },
    });
    if (changed.count !== 1) return;
    await releaseReservations(tx, run);
    await tx.auditEvent.create({
      data: {
        agentId: run.agentId,
        ownerType: run.ownerType,
        ownerId: run.ownerId,
        action: "agent.run.cancelled",
        targetType: "AgentRun",
        targetId: run.id,
        outcome: "DENIED",
        policyVersion: String(run.agentConfigurationVersion),
        correlationId: randomUUID(),
        metadata: { reason: "AUTHORIZATION_REVOKED" },
      },
    });
  });
  return { status: "CANCELLED", runId: run.id, reason: "AUTHORIZATION_REVOKED" };
}

export async function runAgentWorkerOnce(args: {
  prisma: PrismaClient;
  provider: AgentPlanProvider;
  moderator: TextModerator;
  workerId?: string;
  now?: Date;
}): Promise<AgentWorkerResult> {
  const { prisma, provider, moderator } = args;
  const workerId = args.workerId ?? randomUUID();
  const now = args.now ?? new Date();
  const configuredDailyLimit = Number(process.env.OPENAI_AGENT_MAX_DAILY_RUNS ?? "20");
  const dailyLimit = Number.isInteger(configuredDailyLimit) && configuredDailyLimit >= 0 && configuredDailyLimit <= 1000
    ? configuredDailyLimit
    : 20;
  const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const recentRunCount = await prisma.agentRun.count({ where: { createdAt: { gte: last24Hours } } });
  if (dailyLimit === 0 || recentRunCount >= dailyLimit) {
    return { status: "THROTTLED", reason: "DAILY_RUN_LIMIT" };
  }

  const claimed = await claimNextRun(prisma, workerId, now);
  if (!claimed) return { status: "IDLE" };

  const authorization = await prisma.$transaction((tx) =>
    validateLiveAuthorization(tx, claimed, new Date())
  );
  if (!authorization) {
    return cancelRunForAuthorizationFailure(prisma, claimed, workerId, new Date());
  }

  if (mayContainChildSexualAbuse(claimed.task)) {
    return failRun(prisma, claimed, workerId, "SAFETY_REVIEW_REQUIRED", false, new Date());
  }

  let inputModeration: { flagged: boolean };
  try {
    inputModeration = await moderator.moderate(claimed.task);
  } catch {
    return failRun(prisma, claimed, workerId, "MODERATION_UNAVAILABLE", true, new Date());
  }
  if (inputModeration.flagged) {
    return failRun(prisma, claimed, workerId, "INPUT_MODERATION_BLOCKED", false, new Date());
  }

  const planningRequest: AgentPlanningRequest = {
    task: claimed.task,
    trustedContext: {
      agentName: authorization.agentName,
      agentPurpose: authorization.agentPurpose,
      allowedActions: authorization.allowedActions,
    },
    untrustedSources: [],
    safetyIdentifier: safetyIdentifierForUser(claimed.requesterUserId),
  };
  const planned = await createAgentPlan(provider, planningRequest);
  if (planned.status === "PROVIDER_ERROR") {
    return failRun(prisma, claimed, workerId, planned.code, planned.retryable, new Date());
  }
  if (planned.status === "INVALID_PLAN") {
    return failRun(
      prisma,
      claimed,
      workerId,
      planned.reason === "UNAUTHORIZED_ACTION" ? "UNAUTHORIZED_PLAN_ACTION" : "INVALID_PLAN",
      false,
      new Date(),
    );
  }

  const moderationText = [
    planned.plan.summary,
    ...planned.plan.steps.map((step) => step.description),
    ...planned.plan.steps.flatMap((step) => Object.values(step.input).map(String)),
  ].join("\n");
  if (moderationText.length > 16_000) {
    return failRun(prisma, claimed, workerId, "OUTPUT_TOO_LARGE", false, new Date());
  }

  let outputModeration: { flagged: boolean };
  try {
    outputModeration = await moderator.moderate(moderationText);
  } catch {
    return failRun(prisma, claimed, workerId, "MODERATION_UNAVAILABLE", true, new Date());
  }
  if (outputModeration.flagged) {
    return failRun(prisma, claimed, workerId, "OUTPUT_MODERATION_BLOCKED", false, new Date());
  }

  const persistedAt = new Date();
  let saved: boolean;
  try {
    saved = await prisma.$transaction(async (tx) => {
    const current = await tx.agentRun.findFirst({
      where: { id: claimed.id, status: "PLANNING", workerId },
    });
    if (!current) return false;

    const liveAuthorization = await validateLiveAuthorization(tx, current, persistedAt);
    if (!liveAuthorization) {
      const cancelled = await tx.agentRun.updateMany({
        where: { id: current.id, status: "PLANNING", workerId },
        data: {
          status: "CANCELLED",
          errorCode: "AUTHORIZATION_REVOKED",
          cancelledAt: persistedAt,
          completedAt: persistedAt,
          workerId: null,
          claimedAt: null,
          leaseExpiresAt: null,
        },
      });
      if (cancelled.count === 1) {
        await releaseReservations(tx, current);
        await tx.auditEvent.create({
          data: {
            agentId: current.agentId,
            ownerType: current.ownerType,
            ownerId: current.ownerId,
            action: "agent.run.cancelled",
            targetType: "AgentRun",
            targetId: current.id,
            outcome: "DENIED",
            policyVersion: String(current.agentConfigurationVersion),
            correlationId: randomUUID(),
            metadata: { reason: "AUTHORIZATION_REVOKED_DURING_PLANNING" },
          },
        });
      }
      return false;
    }

    await tx.agentRunStep.createMany({
      data: planned.plan.steps.map((step, ordinal) => ({
        runId: current.id,
        stepId: step.id,
        ordinal,
        action: step.action,
        description: step.description,
        input: step.input as Prisma.InputJsonObject,
        createdAt: persistedAt,
        updatedAt: persistedAt,
      })),
    });

    const changed = await tx.agentRun.updateMany({
      where: { id: current.id, status: "PLANNING", workerId },
      data: {
        status: "PLANNED",
        planSummary: planned.plan.summary,
        planSources: planned.plan.sources as Prisma.InputJsonArray,
        plannedAt: persistedAt,
        completedAt: persistedAt,
        workerId: null,
        claimedAt: null,
        leaseExpiresAt: null,
        errorCode: null,
      },
    });
    if (changed.count !== 1) throw new Error("WORKER_LEASE_LOST");

    for (const grantId of current.grantIds) {
      const consumed = await tx.permissionGrant.updateMany({
        where: {
          id: grantId,
          agentId: current.agentId,
          status: "ACTIVE",
          expiresAt: { gt: persistedAt },
          reservedUses: { gt: 0 },
        },
        data: {
          reservedUses: { decrement: 1 },
          uses: { increment: 1 },
        },
      });
      if (consumed.count !== 1) throw new Error("GRANT_CONSUMPTION_CONFLICT");
    }

    await tx.auditEvent.create({
      data: {
        agentId: current.agentId,
        ownerType: current.ownerType,
        ownerId: current.ownerId,
        action: "agent.run.planned",
        targetType: "AgentRun",
        targetId: current.id,
        outcome: "COMPLETED",
        policyVersion: String(liveAuthorization.configurationVersion),
        correlationId: randomUUID(),
        metadata: {
          stepCount: planned.plan.steps.length,
          sourceCount: planned.plan.sources.length,
          externalExecution: false,
        },
      },
    });
    return true;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "GRANT_CONSUMPTION_CONFLICT") {
      return cancelRunForAuthorizationFailure(prisma, claimed, workerId, new Date());
    }
    throw error;
  }

  if (!saved) return { status: "CANCELLED", runId: claimed.id, reason: "LEASE_OR_AUTHORIZATION_LOST" };
  return {
    status: "PLANNED",
    runId: claimed.id,
    stepCount: planned.plan.steps.length,
    sourceCount: planned.plan.sources.length,
  };
}
