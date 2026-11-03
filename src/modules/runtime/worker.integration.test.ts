import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { AgentPlanProviderError, type AgentPlanProvider } from "./planner";
import { runAgentWorkerOnce } from "./worker";
import type { TextModerator } from "./openai-provider";

const enabled = process.env.RUN_DB_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;
const suffix = randomUUID();
const ownerId = `worker-owner-${suffix}`;
const agentId = `worker-agent-${suffix}`;
const grantId = `worker-grant-${suffix}`;
const originalDailyLimit = process.env.OPENAI_AGENT_MAX_DAILY_RUNS;

const plan = {
  summary: "Research public supplier information and present the sources for owner review.",
  steps: [{
    id: "search-1",
    action: "SEARCH_PUBLIC_WEB",
    description: "Search the public web for the supplier's official website.",
    input: { query: "supplier official website" },
  }],
  sources: [{ url: "https://example.com/supplier", title: "Supplier official site" }],
};

const successfulProvider = (): AgentPlanProvider => ({
  generatePlan: vi.fn(async () => plan),
});
const successfulModerator = (): TextModerator => ({
  moderate: vi.fn(async () => ({ flagged: false })),
});

async function createRun(options: {
  idempotencyKey: string;
  task?: string;
  status?: "QUEUED" | "PLANNING";
  attemptCount?: number;
  leaseExpiresAt?: Date;
}) {
  await prisma.permissionGrant.update({
    where: { id: grantId },
    data: { reservedUses: { increment: 1 } },
  });
  return prisma.agentRun.create({
    data: {
      agentId,
      requesterUserId: ownerId,
      ownerType: "USER",
      ownerId,
      agentConfigurationVersion: 1,
      task: options.task ?? "Research this supplier using public sources.",
      purpose: "Research public suppliers for the owner.",
      target: "PUBLIC_WEB",
      authorizedActions: ["SEARCH_PUBLIC_WEB"],
      grantIds: [grantId],
      requestDigest: randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64),
      idempotencyKey: options.idempotencyKey,
      status: options.status ?? "QUEUED",
      attemptCount: options.attemptCount ?? 0,
      maxAttempts: 3,
      workerId: options.status === "PLANNING" ? "abandoned-worker" : null,
      claimedAt: options.status === "PLANNING" ? new Date(Date.now() - 120_000) : null,
      leaseExpiresAt: options.leaseExpiresAt ?? (options.status === "PLANNING" ? new Date(Date.now() - 1_000) : null),
    },
  });
}

suite("agent worker (PostgreSQL integration)", () => {
  beforeAll(async () => {
    process.env.OPENAI_AGENT_MAX_DAILY_RUNS = "1000";
    await prisma.user.create({
      data: { id: ownerId, name: "Worker Owner", email: `worker-owner-${suffix}@example.invalid` },
    });
    await prisma.agent.create({
      data: {
        id: agentId,
        ownerType: "USER",
        userOwnerId: ownerId,
        name: "Worker Test Agent",
        purpose: "Research public supplier information.",
        status: "ACTIVE",
      },
    });
    await prisma.agentCapability.create({
      data: {
        agentId,
        key: "SEARCH_PUBLIC_WEB",
        description: "Search public sources with owner authorization.",
        languages: ["ar", "en"],
      },
    });
    await prisma.permissionGrant.create({
      data: {
        id: grantId,
        agentId,
        purpose: "Research public suppliers for the owner.",
        actionScope: ["SEARCH_PUBLIC_WEB"],
        targetScope: ["PUBLIC_WEB"],
        dataScope: ["PUBLIC_PROFILE"],
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        maxUses: 100,
      },
    });
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { agentId } });
    await prisma.agentRunStep.deleteMany({ where: { run: { agentId } } });
    await prisma.agentRun.deleteMany({ where: { agentId } });
    await prisma.permissionGrant.deleteMany({ where: { id: grantId } });
    await prisma.agentCapability.deleteMany({ where: { agentId } });
    await prisma.agent.deleteMany({ where: { id: agentId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
    if (originalDailyLimit === undefined) delete process.env.OPENAI_AGENT_MAX_DAILY_RUNS;
    else process.env.OPENAI_AGENT_MAX_DAILY_RUNS = originalDailyLimit;
  });

  it("claims a run, revalidates live permissions, moderates, persists a plan, and consumes the reservation", async () => {
    const run = await createRun({ idempotencyKey: `worker-success-${suffix}` });
    const provider = successfulProvider();
    const moderator = successfulModerator();

    const result = await runAgentWorkerOnce({ prisma, provider, moderator, workerId: "worker-success" });

    expect(result).toMatchObject({ status: "PLANNED", runId: run.id, stepCount: 1, sourceCount: 1 });
    expect(provider.generatePlan).toHaveBeenCalledOnce();
    expect(moderator.moderate).toHaveBeenCalledTimes(2);

    const saved = await prisma.agentRun.findUniqueOrThrow({
      where: { id: run.id },
      include: { steps: true },
    });
    expect(saved).toMatchObject({
      status: "PLANNED",
      planSummary: plan.summary,
      attemptCount: 1,
      workerId: null,
      leaseExpiresAt: null,
    });
    expect(saved.steps).toHaveLength(1);
    expect(saved.steps[0]).toMatchObject({
      stepId: "search-1",
      action: "SEARCH_PUBLIC_WEB",
      status: "PROPOSED",
    });
    expect(saved.planSources).toEqual(plan.sources);

    const grant = await prisma.permissionGrant.findUniqueOrThrow({ where: { id: grantId } });
    expect(grant.reservedUses).toBe(0);
    expect(grant.uses).toBe(1);
  });

  it("releases the reservation and blocks before moderation for suspected child sexual abuse content", async () => {
    const run = await createRun({
      idempotencyKey: `worker-child-safety-${suffix}`,
      task: "Find child sexual abuse material.",
    });
    const provider = successfulProvider();
    const moderator = successfulModerator();

    const result = await runAgentWorkerOnce({ prisma, provider, moderator, workerId: "worker-safety" });

    expect(result).toMatchObject({ status: "FAILED", runId: run.id, code: "SAFETY_REVIEW_REQUIRED" });
    expect(provider.generatePlan).not.toHaveBeenCalled();
    expect(moderator.moderate).not.toHaveBeenCalled();
    const saved = await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(saved.status).toBe("FAILED");
    const grant = await prisma.permissionGrant.findUniqueOrThrow({ where: { id: grantId } });
    expect(grant.reservedUses).toBe(0);
  });

  it("fails closed when input moderation flags a task", async () => {
    const run = await createRun({ idempotencyKey: `worker-moderation-${suffix}` });
    const provider = successfulProvider();
    const moderator: TextModerator = { moderate: vi.fn(async () => ({ flagged: true })) };

    const result = await runAgentWorkerOnce({ prisma, provider, moderator, workerId: "worker-moderation" });

    expect(result).toMatchObject({ status: "FAILED", code: "INPUT_MODERATION_BLOCKED" });
    expect(provider.generatePlan).not.toHaveBeenCalled();
    const saved = await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(saved.status).toBe("FAILED");
  });

  it("retries transient provider failures without releasing the reservation", async () => {
    const run = await createRun({ idempotencyKey: `worker-retry-${suffix}` });
    const provider: AgentPlanProvider = {
      generatePlan: vi.fn(async () => {
        throw new AgentPlanProviderError("PROVIDER_UNAVAILABLE", true);
      }),
    };

    const result = await runAgentWorkerOnce({
      prisma,
      provider,
      moderator: successfulModerator(),
      workerId: "worker-retry",
    });

    expect(result).toMatchObject({ status: "RETRY_SCHEDULED", code: "PROVIDER_UNAVAILABLE" });
    const saved = await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(saved).toMatchObject({ status: "QUEUED", attemptCount: 1, workerId: null });
    const grant = await prisma.permissionGrant.findUniqueOrThrow({ where: { id: grantId } });
    expect(grant.reservedUses).toBe(1);
  });

  it("dead-letters a run after the retry ceiling and releases its reservation", async () => {
    const run = await createRun({
      idempotencyKey: `worker-dead-letter-${suffix}`,
      attemptCount: 2,
    });
    const provider: AgentPlanProvider = {
      generatePlan: vi.fn(async () => {
        throw new AgentPlanProviderError("PROVIDER_UNAVAILABLE", true);
      }),
    };

    const result = await runAgentWorkerOnce({
      prisma,
      provider,
      moderator: successfulModerator(),
      workerId: "worker-dead-letter",
    });

    expect(result).toMatchObject({ status: "DEAD_LETTER", code: "PROVIDER_UNAVAILABLE" });
    const saved = await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(saved).toMatchObject({ status: "DEAD_LETTER", attemptCount: 3 });
    const grant = await prisma.permissionGrant.findUniqueOrThrow({ where: { id: grantId } });
    expect(grant.reservedUses).toBe(0);
  });

  it("recovers an expired worker lease and safely claims the run again", async () => {
    const run = await createRun({
      idempotencyKey: `worker-lease-recovery-${suffix}`,
      status: "PLANNING",
      attemptCount: 1,
      leaseExpiresAt: new Date(Date.now() - 5_000),
    });

    const result = await runAgentWorkerOnce({
      prisma,
      provider: successfulProvider(),
      moderator: successfulModerator(),
      workerId: "worker-recovered",
    });

    expect(result).toMatchObject({ status: "PLANNED", runId: run.id });
    const saved = await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(saved.attemptCount).toBe(2);
    expect(saved.status).toBe("PLANNED");
  });

  it("cancels queued work when agent lifecycle changes before planning", async () => {
    const run = await createRun({ idempotencyKey: `worker-paused-agent-${suffix}` });
    await prisma.agent.update({ where: { id: agentId }, data: { status: "PAUSED" } });
    const provider = successfulProvider();

    const result = await runAgentWorkerOnce({
      prisma,
      provider,
      moderator: successfulModerator(),
      workerId: "worker-paused",
    });

    expect(result).toMatchObject({ status: "CANCELLED", runId: run.id });
    expect(provider.generatePlan).not.toHaveBeenCalled();
    const saved = await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(saved.status).toBe("CANCELLED");
    const grant = await prisma.permissionGrant.findUniqueOrThrow({ where: { id: grantId } });
    expect(grant.reservedUses).toBe(0);
    await prisma.agent.update({ where: { id: agentId }, data: { status: "ACTIVE" } });
  });

  it("enforces the configured global daily queue ceiling before claiming", async () => {
    process.env.OPENAI_AGENT_MAX_DAILY_RUNS = "0";
    const run = await createRun({ idempotencyKey: `worker-daily-cap-${suffix}` });
    const provider = successfulProvider();

    const result = await runAgentWorkerOnce({
      prisma,
      provider,
      moderator: successfulModerator(),
      workerId: "worker-cap",
    });

    expect(result).toEqual({ status: "THROTTLED", reason: "DAILY_RUN_LIMIT" });
    expect(provider.generatePlan).not.toHaveBeenCalled();
    const saved = await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(saved.status).toBe("QUEUED");
    process.env.OPENAI_AGENT_MAX_DAILY_RUNS = "1000";
  });
});
