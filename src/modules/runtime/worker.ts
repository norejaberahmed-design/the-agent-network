import { randomUUID } from "node:crypto";
import { Prisma, type AgentRun, type PrismaClient } from "@prisma/client";
import {
  createAgentPlan,
  type AgentPlanProvider,
  type AgentPlanningRequest,
} from "./planner";
import { lockAgentRuntime, lockGrantRows } from "./locks";
import { selectPersonalContext } from "@/modules/memory/context";
import { extractExplicitMemorySuggestions } from "@/modules/memory/suggestion-extractor";
import {
  mayContainChildSexualAbuse,
  mayContainCredentialOrSecret,
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
  persona?: { displayName: string; tone: string; goal: string };
  personalMemory?: NonNullable<AgentPlanningRequest["trustedContext"]["personalMemory"]>;
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
  if (run.grantIds.length === 0 || run.authorizedActions.length === 0 ||
    !run.providerConsentAt || run.providerConsentVersion !== "ai-processing-v1" ||
    run.expiresAt <= now) return null;

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

  const allowedActions = run.authorizedActions.filter(
    (action): action is AgentPlanningRequest["trustedContext"]["allowedActions"][number] =>
      (action === "READ_PUBLIC_PROFILE" && declared.has(action) && granted.has(action)) ||
      (action === "SEARCH_PUBLIC_WEB" && declared.has(action) && granted.has(action))
  );
  if (allowedActions.length !== run.authorizedActions.length) return null;

  const persona = run.ownerType === "USER"
    ? await tx.userPersona.findUnique({
        where: { userId: run.requesterUserId },
        select: { displayName: true, tone: true, goal: true, memoryContextEnabled: true },
      })
    : null;

  const memoryRows = persona?.memoryContextEnabled
    ? await tx.personalMemory.findMany({
        where: {
          userId: run.requesterUserId,
          status: "ACTIVE",
          classification: { in: ["PUBLIC", "CONTEXTUAL"] },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: {
          id: true,
          kind: true,
          content: true,
          purpose: true,
          classification: true,
          confidence: true,
          sourceType: true,
          sourceReference: true,
          expiresAt: true,
          taskContextRunId: true,
          status: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 50,
      })
    : [];
  const personalMemory = selectPersonalContext(memoryRows, {
    now,
    runId: run.id,
    maxItems: 20,
  }).map((memory) => ({
    kind: memory.kind,
    content: memory.content,
    purpose: memory.purpose,
    confidence: memory.confidence,
    sourceType: memory.sourceType,
  }));

  return {
    agentName: agent.name,
    agentPurpose: agent.purpose,
    allowedActions: [...allowedActions, "ASK_OWNER"],
    configurationVersion: agent.configurationVersion,
    ...(persona ? { persona: { displayName: persona.displayName, tone: persona.tone, goal: persona.goal } } : {}),
    ...(personalMemory.length > 0 ? { personalMemory } : {}),
  };
}

type ClaimResult =
  | { kind: "CLAIMED"; run: AgentRun }
  | { kind: "CANCELLED"; runId: string; reason: string }
  | { kind: "DEAD_LETTER"; runId: string; code: string };

async function claimNextRun(
  prisma: PrismaClient,
  workerId: string,
  now: Date,
): Promise<ClaimResult | null> {
  let lastTerminal: Exclude<ClaimResult, { kind: "CLAIMED" }> | null = null;
  // Candidate discovery is intentionally unlocked. The per-agent row lock,
  // followed by deterministic grant row locks and a conditional update, is the
  // linearization point shared with cancellation, lifecycle and grant revocation.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = await prisma.agentRun.findFirst({
      where: {
        OR: [
          { status: "QUEUED", availableAt: { lte: now } },
          { status: "PLANNING", leaseExpiresAt: { lte: now } },
        ],
      },
      orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
    });
    if (!candidate) return lastTerminal;

    const result = await prisma.$transaction(async (tx) => {
      await lockAgentRuntime(tx, candidate.agentId);
      let current = await tx.agentRun.findUnique({ where: { id: candidate.id } });
      if (!current) return null;
      if (
        current.status !== "QUEUED" && current.status !== "PLANNING"
      ) return null;
      if (
        (current.status === "QUEUED" && current.availableAt > now) ||
        (current.status === "PLANNING" && (!current.leaseExpiresAt || current.leaseExpiresAt > now))
      ) return null;

      await lockGrantRows(tx, current.grantIds);
      current = await tx.agentRun.findUnique({ where: { id: candidate.id } });
      if (!current) return null;
      if (
        current.status !== "QUEUED" && current.status !== "PLANNING"
      ) return null;
      if (
        (current.status === "QUEUED" && current.availableAt > now) ||
        (current.status === "PLANNING" && (!current.leaseExpiresAt || current.leaseExpiresAt > now))
      ) return null;

      if (current.attemptCount >= current.maxAttempts) {
        const dead = await tx.agentRun.updateMany({
          where: {
            id: current.id,
            status: current.status,
            attemptCount: current.attemptCount,
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
        if (dead.count === 1) {
          await releaseReservations(tx, current);
          await tx.auditEvent.create({
            data: {
              agentId: current.agentId,
              ownerType: current.ownerType,
              ownerId: current.ownerId,
              action: "agent.run.dead_lettered",
              targetType: "AgentRun",
              targetId: current.id,
              outcome: "FAILED",
              policyVersion: String(current.agentConfigurationVersion),
              correlationId: randomUUID(),
              metadata: { reason: "WORKER_LEASE_EXHAUSTED", attemptCount: current.attemptCount },
            },
          });
        }
        return dead.count === 1
          ? { kind: "DEAD_LETTER" as const, runId: current.id, code: "WORKER_LEASE_EXHAUSTED" }
          : null;
      }

      const authorization = await validateLiveAuthorization(tx, current, now);
      if (!authorization) {
        const cancelled = await tx.agentRun.updateMany({
          where: {
            id: current.id,
            status: current.status,
            attemptCount: current.attemptCount,
          },
          data: {
            status: "CANCELLED",
            errorCode: "AUTHORIZATION_REVOKED",
            cancelledAt: now,
            completedAt: now,
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
              metadata: { reason: "AUTHORIZATION_REVOKED_BEFORE_CLAIM" },
            },
          });
        }
        return cancelled.count === 1
          ? { kind: "CANCELLED" as const, runId: current.id, reason: "AUTHORIZATION_REVOKED" }
          : null;
      }

      const leaseUntil = new Date(now.getTime() + 90_000);
      const changed = await tx.agentRun.updateMany({
        where: {
          id: current.id,
          status: current.status,
          attemptCount: current.attemptCount,
          ...(current.status === "QUEUED"
            ? { availableAt: { lte: now } }
            : { leaseExpiresAt: { lte: now } }),
        },
        data: {
          status: "PLANNING",
          workerId,
          claimedAt: now,
          leaseExpiresAt: leaseUntil,
          attemptCount: { increment: 1 },
          startedAt: current.startedAt ?? now,
          errorCode: null,
        },
      });
      if (changed.count !== 1) return null;
      const claimed = await tx.agentRun.findUnique({ where: { id: current.id } });
      return claimed ? { kind: "CLAIMED" as const, run: claimed } : null;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 10_000,
    });

    if (result?.kind === "CLAIMED") return result;
    if (result?.kind === "CANCELLED" || result?.kind === "DEAD_LETTER") {
      lastTerminal = result;
    }
  }
  return lastTerminal;
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

  let updated = false;
  await prisma.$transaction(async (tx) => {
    await lockAgentRuntime(tx, run.agentId);
    await lockGrantRows(tx, run.grantIds);
    const current = await tx.agentRun.findFirst({ where: { id: run.id, status: "PLANNING", workerId } });
    if (!current) return;
    const changed = await tx.agentRun.updateMany({
      where: { id: current.id, status: "PLANNING", workerId },
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
    updated = true;

    if (!shouldRetry) await releaseReservations(tx, current);

    await tx.auditEvent.create({
      data: {
        agentId: current.agentId,
        ownerType: current.ownerType,
        ownerId: current.ownerId,
        action: shouldRetry ? "agent.run.retry_scheduled" : "agent.run.failed",
        targetType: "AgentRun",
        targetId: current.id,
        outcome: "FAILED",
        policyVersion: String(current.agentConfigurationVersion),
        correlationId: randomUUID(),
        metadata: {
          errorCode: code,
          attemptCount: current.attemptCount,
          maxAttempts: current.maxAttempts,
          reservationReleased: !shouldRetry,
        },
      },
    });
  });

  if (!updated) return { status: "CANCELLED", runId: run.id, reason: "RUN_NO_LONGER_OWNED" };
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
    await lockAgentRuntime(tx, run.agentId);
    await lockGrantRows(tx, run.grantIds);
    const current = await tx.agentRun.findFirst({
      where: { id: run.id, status: "PLANNING", workerId },
    });
    if (!current) return;
    const changed = await tx.agentRun.updateMany({
      where: { id: current.id, status: "PLANNING", workerId },
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

  const claim = await claimNextRun(prisma, workerId, now);
  if (!claim) return { status: "IDLE" };
  if (claim.kind === "CANCELLED") {
    return { status: "CANCELLED", runId: claim.runId, reason: claim.reason };
  }
  if (claim.kind === "DEAD_LETTER") {
    return { status: "DEAD_LETTER", runId: claim.runId, code: claim.code };
  }
  const claimed = claim.run;

  const authorization = await prisma.$transaction(async (tx) => {
    await lockAgentRuntime(tx, claimed.agentId);
    await lockGrantRows(tx, claimed.grantIds);
    const current = await tx.agentRun.findFirst({
      where: { id: claimed.id, status: "PLANNING", workerId },
    });
    if (!current) return null;
    return validateLiveAuthorization(tx, current, new Date());
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (!authorization) {
    return cancelRunForAuthorizationFailure(prisma, claimed, workerId, new Date());
  }

  if (mayContainChildSexualAbuse(claimed.task)) {
    return failRun(prisma, claimed, workerId, "SAFETY_REVIEW_REQUIRED", false, new Date());
  }
  if (mayContainCredentialOrSecret(claimed.task)) {
    return failRun(prisma, claimed, workerId, "SENSITIVE_INPUT_BLOCKED", false, new Date());
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
      ...(authorization.persona ? { persona: authorization.persona } : {}),
      ...(authorization.personalMemory ? { personalMemory: authorization.personalMemory } : {}),
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
      planned.reason === "UNAUTHORIZED_ACTION"
        ? "UNAUTHORIZED_PLAN_ACTION"
        : planned.reason === "UNVERIFIED_SOURCE"
          ? "UNVERIFIED_SOURCE_CITATION"
          : "INVALID_PLAN",
      false,
      new Date(),
    );
  }

  const moderationText = [
    planned.plan.summary,
    ...planned.plan.steps.map((step) => step.description),
    ...planned.plan.steps.flatMap((step) => Object.values(step.input).map(String)),
    ...planned.plan.sources.map((source) => source.title),
    ...planned.plan.evidence.map((item) => item.claim),
  ].join("\n");
  if (moderationText.length > 16_000) {
    return failRun(prisma, claimed, workerId, "OUTPUT_TOO_LARGE", false, new Date());
  }
  if (mayContainChildSexualAbuse(moderationText)) {
    return failRun(prisma, claimed, workerId, "SAFETY_REVIEW_REQUIRED", false, new Date());
  }
  if (mayContainCredentialOrSecret(moderationText)) {
    return failRun(prisma, claimed, workerId, "SENSITIVE_OUTPUT_BLOCKED", false, new Date());
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

  const persistedSources = planned.plan.sources.map((source) => {
    const evidence = planned.plan.evidence
      .filter((item) => item.sourceUrl === source.url)
      .map((item) => ({ claim: item.claim }));
    return evidence.length > 0 ? { ...source, evidence } : source;
  });
  const persistedAt = new Date();
  let saved: boolean;
  try {
    saved = await prisma.$transaction(async (tx) => {
    await lockAgentRuntime(tx, claimed.agentId);
    await lockGrantRows(tx, claimed.grantIds);
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
        id: randomUUID(),
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
        planSources: persistedSources as Prisma.InputJsonArray,
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

    if (current.ownerType === "USER" && current.ownerId === current.requesterUserId) {
      const learningConsent = await tx.userPersona.findUnique({
        where: { userId: current.requesterUserId },
        select: { memoryLearningEnabled: true },
      });
      if (learningConsent?.memoryLearningEnabled) {
        const suggestions = extractExplicitMemorySuggestions(current.task);
        for (const suggestion of suggestions) {
          const created = await tx.memorySuggestion.createMany({
            data: [{
              userId: current.requesterUserId,
              sourceRunId: current.id,
              content: suggestion.content,
              evidenceExcerpt: suggestion.evidenceExcerpt,
              confidence: suggestion.confidence,
              dedupeKey: suggestion.dedupeKey,
            }],
            skipDuplicates: true,
          });
          if (created.count === 1) {
            await tx.auditEvent.create({
              data: {
                actorUserId: current.requesterUserId,
                agentId: current.agentId,
                ownerType: "USER",
                ownerId: current.requesterUserId,
                action: "personal_memory.suggestion_created",
                targetType: "MemorySuggestion",
                targetId: suggestion.dedupeKey,
                outcome: "COMPLETED",
                correlationId: randomUUID(),
                metadata: { sourceRunId: current.id, confidenceBand: "HIGH", extractor: "explicit-preference-v1" },
              },
            });
          }
        }
      }
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
