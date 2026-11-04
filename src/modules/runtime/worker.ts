import { randomUUID } from "node:crypto";
import { Prisma, type AgentRun, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Tx = Prisma.TransactionClient;
type WorkerDatabase = PrismaClient | Tx;

export type ClaimedAgentRun = Pick<
  AgentRun,
  | "id"
  | "agentId"
  | "task"
  | "purpose"
  | "target"
  | "authorizedActions"
  | "grantIds"
  | "attemptCount"
  | "maxAttempts"
  | "agentConfigurationVersion"
  | "leaseExpiresAt"
  | "workerId"
>;

const ACTION_TO_GRANT: Record<string, string> = {
  READ_PUBLIC_PROFILE: "DISCOVER_INTERNAL",
  SEARCH_PUBLIC_WEB: "SEARCH_PUBLIC_WEB",
};

function retryDelayMs(attemptCount: number): number {
  return Math.min(5 * 60_000, 30_000 * 2 ** Math.max(0, attemptCount - 1));
}

async function releaseReservations(tx: Tx, run: Pick<AgentRun, "agentId" | "grantIds">) {
  for (const grantId of run.grantIds) {
    const released = await tx.permissionGrant.updateMany({
      where: { id: grantId, agentId: run.agentId, reservedUses: { gt: 0 } },
      data: { reservedUses: { decrement: 1 } },
    });
    if (released.count !== 1) throw new Error("GRANT_RESERVATION_INVARIANT");
  }
}

async function auditWorkerEvent(
  tx: Tx,
  run: AgentRun,
  action: string,
  outcome: "ALLOWED" | "COMPLETED" | "FAILED",
  correlationId: string,
  metadata: Prisma.InputJsonObject,
) {
  await tx.auditEvent.create({
    data: {
      agentId: run.agentId,
      ownerType: run.ownerType,
      ownerId: run.ownerId,
      action,
      targetType: "AgentRun",
      targetId: run.id,
      outcome,
      policyVersion: String(run.agentConfigurationVersion),
      correlationId,
      metadata,
    },
  });
}

async function cancelInvalidQueuedRun(tx: Tx, run: AgentRun, reason: string, now: Date) {
  const changed = await tx.agentRun.updateMany({
    where: { id: run.id, status: "QUEUED" },
    data: { status: "CANCELLED", cancelledAt: now, errorCode: reason },
  });
  if (changed.count !== 1) return false;
  await releaseReservations(tx, run);
  await auditWorkerEvent(tx, run, "agent.run.cancelled", "FAILED", randomUUID(), {
    reason,
    source: "worker_preflight",
  });
  return true;
}

async function claimOne(tx: Tx, workerId: string, leaseMs: number, now: Date) {
  const candidate = await tx.agentRun.findFirst({
    where: { status: "QUEUED", availableAt: { lte: now } },
    orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
  });
  if (!candidate) return null;

  // Lock the grant rows before checking them. Revocation updates the same rows,
  // so either revocation wins and this claim sees it, or this claim wins and
  // revocation subsequently cancels the claimed-but-not-executing run.
  if (candidate.grantIds.length > 0) {
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "PermissionGrant"
      WHERE "id" IN (${Prisma.join(candidate.grantIds)})
      ORDER BY "id"
      FOR UPDATE
    `);
  }

  const current = await tx.agentRun.findUnique({ where: { id: candidate.id } });
  if (!current || current.status !== "QUEUED" || current.availableAt > now) return null;

  const agent = await tx.agent.findUnique({
    where: { id: current.agentId },
    select: { status: true, configurationVersion: true },
  });
  if (!agent || agent.status !== "ACTIVE") {
    await cancelInvalidQueuedRun(tx, current, "AGENT_NOT_ACTIVE", now);
    return null;
  }

  const requiredActions = [...new Set(current.authorizedActions)];
  const requiredGrantScopes = requiredActions.map((action) => ACTION_TO_GRANT[action]);
  if (
    requiredActions.length === 0 ||
    requiredGrantScopes.some((scope) => !scope) ||
    current.grantIds.length === 0
  ) {
    await cancelInvalidQueuedRun(tx, current, "INVALID_AUTHORIZATION_SNAPSHOT", now);
    return null;
  }

  const [capabilities, grants] = await Promise.all([
    tx.agentCapability.findMany({
      where: { agentId: current.agentId, key: { in: requiredActions } },
      select: { key: true },
    }),
    tx.permissionGrant.findMany({
      where: {
        id: { in: current.grantIds },
        agentId: current.agentId,
        purpose: current.purpose,
        targetScope: { has: current.target },
        dataScope: { has: "PUBLIC_PROFILE" },
        status: "ACTIVE",
        expiresAt: { gt: now },
      },
      select: { id: true, actionScope: true, reservedUses: true },
    }),
  ]);

  const capabilityKeys = new Set(capabilities.map((item) => item.key));
  const grantIds = new Set(grants.map((grant) => grant.id));
  const actionsAuthorized = requiredActions.every((action) =>
    capabilityKeys.has(action) &&
    grants.some((grant) => grant.actionScope.includes(ACTION_TO_GRANT[action]) && grant.reservedUses > 0)
  );
  if (
    grants.length !== current.grantIds.length ||
    current.grantIds.some((id) => !grantIds.has(id)) ||
    !actionsAuthorized
  ) {
    await cancelInvalidQueuedRun(tx, current, "GRANT_OR_CAPABILITY_REVOKED", now);
    return null;
  }

  const claimedAt = now;
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);
  const changed = await tx.agentRun.updateMany({
    where: {
      id: current.id,
      status: "QUEUED",
      availableAt: { lte: now },
      attemptCount: current.attemptCount,
    },
    data: {
      status: "CLAIMED",
      attemptCount: { increment: 1 },
      claimedAt,
      leaseExpiresAt,
      workerId,
      startedAt: current.startedAt ?? now,
      agentConfigurationVersion: agent.configurationVersion,
    },
  });
  if (changed.count !== 1) return null;

  const updated = await tx.agentRun.findUnique({ where: { id: current.id } });
  if (!updated) throw new Error("CLAIMED_RUN_MISSING");
  await auditWorkerEvent(tx, updated, "agent.run.claimed", "ALLOWED", randomUUID(), {
    workerId,
    attemptCount: updated.attemptCount,
    leaseExpiresAt: leaseExpiresAt.toISOString(),
    revalidatedConfigurationVersion: agent.configurationVersion,
  });
  return updated;
}

/** Atomically leases one queued run. It does not call a model or execute a tool. */
export async function claimNextAgentRun(
  workerId: string,
  options: { leaseMs?: number } = {},
): Promise<ClaimedAgentRun | null> {
  if (!/^[A-Za-z0-9._:-]{3,64}$/.test(workerId)) throw new Error("INVALID_WORKER_ID");
  const leaseMs = options.leaseMs ?? 60_000;
  if (!Number.isInteger(leaseMs) || leaseMs < 10_000 || leaseMs > 5 * 60_000) {
    throw new Error("INVALID_LEASE_DURATION");
  }
  const now = new Date();
  await recoverExpiredAgentRunLeases();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const run = await prisma.$transaction(
        (tx) => claimOne(tx, workerId, leaseMs, now),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 10_000 },
      );
      return run as ClaimedAgentRun | null;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "P2034" &&
        attempt < 2
      ) continue;
      throw error;
    }
  }
  return null;
}

export async function heartbeatAgentRun(
  runId: string,
  workerId: string,
  leaseMs = 60_000,
): Promise<boolean> {
  if (!Number.isInteger(leaseMs) || leaseMs < 10_000 || leaseMs > 5 * 60_000) return false;
  const now = new Date();
  const updated = await prisma.agentRun.updateMany({
    where: {
      id: runId,
      workerId,
      status: "CLAIMED",
      leaseExpiresAt: { gt: now },
    },
    data: { leaseExpiresAt: new Date(now.getTime() + leaseMs) },
  });
  return updated.count === 1;
}

export async function failAgentRun(
  runId: string,
  workerId: string,
  errorCode: "PROVIDER_UNAVAILABLE" | "INVALID_INPUT" | "WORKER_FAILURE",
  retryable: boolean,
): Promise<"QUEUED" | "FAILED" | "DEAD_LETTER" | null> {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const run = await tx.agentRun.findFirst({
      where: { id: runId, workerId, status: "CLAIMED", leaseExpiresAt: { gt: now } },
    });
    if (!run) return null;

    const terminalStatus = retryable
      ? (run.attemptCount >= run.maxAttempts ? "DEAD_LETTER" : "QUEUED")
      : "FAILED";
    const availableAt = terminalStatus === "QUEUED"
      ? new Date(now.getTime() + retryDelayMs(run.attemptCount))
      : run.availableAt;
    const changed = await tx.agentRun.updateMany({
      where: { id: runId, workerId, status: "CLAIMED", leaseExpiresAt: { gt: now } },
      data: {
        status: terminalStatus,
        availableAt,
        errorCode,
        claimedAt: null,
        leaseExpiresAt: null,
        workerId: null,
        completedAt: terminalStatus === "QUEUED" ? null : now,
      },
    });
    if (changed.count !== 1) return null;
    if (terminalStatus !== "QUEUED") await releaseReservations(tx, run);
    await auditWorkerEvent(
      tx,
      run,
      terminalStatus === "QUEUED" ? "agent.run.retry_scheduled" : "agent.run.failed",
      terminalStatus === "QUEUED" ? "ALLOWED" : "FAILED",
      randomUUID(),
      { errorCode, retryable, resultingStatus: terminalStatus, availableAt: availableAt.toISOString() },
    );
    return terminalStatus;
  });
}

/** Requeues expired leases with bounded backoff; exhausted runs go to dead letter. */
export async function recoverExpiredAgentRunLeases(): Promise<{ requeued: number; deadLettered: number }> {
  const now = new Date();
  const expired = await prisma.agentRun.findMany({
    where: { status: "CLAIMED", leaseExpiresAt: { lte: now } },
    select: { id: true, workerId: true },
    orderBy: { leaseExpiresAt: "asc" },
    take: 100,
  });
  let requeued = 0;
  let deadLettered = 0;

  for (const item of expired) {
    const result = await prisma.$transaction(async (tx) => {
      const run = await tx.agentRun.findFirst({
        where: { id: item.id, status: "CLAIMED", leaseExpiresAt: { lte: now } },
      });
      if (!run) return null;
      const exhausted = run.attemptCount >= run.maxAttempts;
      const status = exhausted ? "DEAD_LETTER" : "QUEUED";
      const availableAt = exhausted
        ? run.availableAt
        : new Date(now.getTime() + retryDelayMs(run.attemptCount));
      const changed = await tx.agentRun.updateMany({
        where: { id: run.id, status: "CLAIMED", leaseExpiresAt: { lte: now } },
        data: {
          status,
          availableAt,
          errorCode: "WORKER_LEASE_EXPIRED",
          claimedAt: null,
          leaseExpiresAt: null,
          workerId: null,
          completedAt: exhausted ? now : null,
        },
      });
      if (changed.count !== 1) return null;
      if (exhausted) await releaseReservations(tx, run);
      await auditWorkerEvent(
        tx,
        run,
        exhausted ? "agent.run.dead_lettered" : "agent.run.lease_expired",
        exhausted ? "FAILED" : "ALLOWED",
        randomUUID(),
        { previousWorkerId: item.workerId, attemptCount: run.attemptCount, resultingStatus: status },
      );
      return status;
    });
    if (result === "QUEUED") requeued += 1;
    if (result === "DEAD_LETTER") deadLettered += 1;
  }
  return { requeued, deadLettered };
}
