import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { AgentPlanProviderError, type AgentPlanProvider } from "./planner";
import { runAgentWorkerOnce } from "./worker";
import { purgeExpiredAgentRuns } from "./retention";
import type { TextModerator } from "./openai-provider";

const enabled = process.env.RUN_DB_INTEGRATION === "1";
const originalDailyLimit = process.env.OPENAI_AGENT_MAX_DAILY_RUNS;
const suite = enabled ? describe : describe.skip;
const suffix = randomUUID();
const ownerId = `worker-owner-${suffix}`;
const agentId = `worker-agent-${suffix}`;
const grantId = `worker-grant-${suffix}`;


const plan = {
  summary: "Research public supplier information and present the sources for owner review.",
  steps: [{
    id: "search-1",
    action: "SEARCH_PUBLIC_WEB",
    description: "Search the public web for the supplier's official website.",
    input: { query: "supplier official website" },
  }],
  sources: [{
    url: "https://example.com/supplier",
    title: "Supplier official site",
  }],
  evidence: [{
    claim: "The page identifies the supplier as a public business.",
    sourceUrl: "https://example.com/supplier",
  }],
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
      providerConsentAt: new Date(),
      providerConsentVersion: "ai-processing-v1",
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
    if (originalDailyLimit === undefined) delete process.env.OPENAI_AGENT_MAX_DAILY_RUNS;
    else process.env.OPENAI_AGENT_MAX_DAILY_RUNS = originalDailyLimit;
    await prisma.auditEvent.deleteMany({ where: { agentId } });
    await prisma.agentRun.deleteMany({ where: { agentId } });
    await prisma.permissionGrant.deleteMany({ where: { id: grantId } });
    await prisma.agentCapability.deleteMany({ where: { agentId } });
    await prisma.agent.deleteMany({ where: { id: agentId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
    if (originalDailyLimit === undefined) delete process.env.OPENAI_AGENT_MAX_DAILY_RUNS;
    else process.env.OPENAI_AGENT_MAX_DAILY_RUNS = originalDailyLimit;
  });

  it("claims a run, applies the owner's persisted persona, revalidates permissions, and persists a plan", async () => {
    await prisma.userPersona.create({
      data: {
        userId: ownerId,
        displayName: "وكيل جابر",
        tone: "واضح ومباشر",
        goal: "البحث عن الموردين الموثوقين",
        memoryContextEnabled: true,
      },
    });
    const run = await createRun({ idempotencyKey: `worker-success-${suffix}` });
    await prisma.personalMemory.createMany({
      data: [
        {
          userId: ownerId, kind: "CONFIRMED", content: "Owner prefers concise Arabic summaries.",
          sourceType: "USER_STATEMENT", purpose: "Response personalization", classification: "CONTEXTUAL",
          confirmedAt: new Date(),
        },
        {
          userId: ownerId, kind: "INFERRED", content: "Owner may prefer short messages.",
          sourceType: "OBSERVED_PATTERN", purpose: "Response personalization", classification: "CONTEXTUAL",
          confidence: 0.79, expiresAt: new Date(Date.now() + 86_400_000),
        },
        {
          userId: ownerId, kind: "INFERRED", content: "Owner frequently requests source links.",
          sourceType: "OBSERVED_PATTERN", purpose: "Research presentation", classification: "PUBLIC",
          confidence: 0.91, expiresAt: new Date(Date.now() + 86_400_000),
        },
        {
          userId: ownerId, kind: "CONFIRMED", content: "Private owner detail.",
          sourceType: "USER_STATEMENT", purpose: "Private", classification: "PRIVATE", confirmedAt: new Date(),
        },
        {
          userId: ownerId, kind: "CONFIRMED", content: "Highly sensitive detail.",
          sourceType: "USER_STATEMENT", purpose: "Sensitive", classification: "HIGHLY_SENSITIVE", confirmedAt: new Date(),
        },
        {
          userId: ownerId, kind: "TASK_CONTEXT", content: "This run is about supplier research.",
          sourceType: "TASK", purpose: "Current task", classification: "CONTEXTUAL",
          taskContextRunId: run.id, expiresAt: new Date(Date.now() + 3_600_000),
        },
      ],
    });
    const provider = successfulProvider();
    const moderator = successfulModerator();

    const result = await runAgentWorkerOnce({ prisma, provider, moderator, workerId: "worker-success" });

    expect(result).toMatchObject({ status: "PLANNED", runId: run.id, stepCount: 1, sourceCount: 1 });
    expect(provider.generatePlan).toHaveBeenCalledOnce();
    expect(provider.generatePlan).toHaveBeenCalledWith(expect.objectContaining({
      trustedContext: expect.objectContaining({
        persona: { displayName: "وكيل جابر", tone: "واضح ومباشر", goal: "البحث عن الموردين الموثوقين" },
        personalMemory: expect.arrayContaining([
          expect.objectContaining({ kind: "CONFIRMED", content: "Owner prefers concise Arabic summaries." }),
          expect.objectContaining({ kind: "INFERRED", content: "Owner frequently requests source links." }),
          expect.objectContaining({ kind: "TASK_CONTEXT", content: "This run is about supplier research." }),
        ]),
      }),
    }));
    const submittedContext = vi.mocked(provider.generatePlan).mock.calls[0][0].trustedContext.personalMemory || [];
    expect(submittedContext.map((item) => item.content)).not.toContain("Owner may prefer short messages.");
    expect(submittedContext.map((item) => item.content)).not.toContain("Private owner detail.");
    expect(submittedContext.map((item) => item.content)).not.toContain("Highly sensitive detail.");
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
    expect(saved.planSources).toEqual(plan.sources.map((source) => ({
      ...source,
      evidence: [{ claim: "The page identifies the supplier as a public business." }],
    })));

    const grant = await prisma.permissionGrant.findUniqueOrThrow({ where: { id: grantId } });
    expect(grant.reservedUses).toBe(0);
    expect(grant.uses).toBe(1);
  });


  it("creates a review-only suggestion from an explicit preference only when learning is enabled and deduplicates it", async () => {
    await prisma.userPersona.upsert({
      where: { userId: ownerId },
      create: {
        userId: ownerId, displayName: "Owner", tone: "واضح ومباشر",
        goal: "Research", memoryContextEnabled: false, memoryLearningEnabled: true,
      },
      update: { memoryLearningEnabled: true },
    });
    const task = "I prefer concise responses. Research this supplier using public sources.";
    const firstRun = await createRun({ idempotencyKey: "worker-memory-learn-a-" + suffix, task });
    const firstResult = await runAgentWorkerOnce({
      prisma, provider: successfulProvider(), moderator: successfulModerator(), workerId: "worker-memory-learn-a",
    });
    expect(firstResult).toMatchObject({ status: "PLANNED", runId: firstRun.id });
    const suggestions = await prisma.memorySuggestion.findMany({ where: { userId: ownerId } });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      status: "PENDING",
      content: "The owner prefers concise responses.",
      evidenceExcerpt: "I prefer concise responses",
      confidence: 0.9,
      sourceRunId: firstRun.id,
    });
    expect(await prisma.personalMemory.count({ where: { userId: ownerId, sourceReference: "AgentRun:" + firstRun.id } })).toBe(0);

    const secondRun = await createRun({ idempotencyKey: "worker-memory-learn-b-" + suffix, task });
    const secondResult = await runAgentWorkerOnce({
      prisma, provider: successfulProvider(), moderator: successfulModerator(), workerId: "worker-memory-learn-b",
    });
    expect(secondResult).toMatchObject({ status: "PLANNED", runId: secondRun.id });
    expect(await prisma.memorySuggestion.count({ where: { userId: ownerId } })).toBe(1);
  });

  it("does not send personal memory to the AI provider unless the owner opted in", async () => {
    await prisma.userPersona.upsert({
      where: { userId: ownerId },
      create: {
        userId: ownerId, displayName: "Owner", tone: "واضح ومباشر",
        goal: "Research", memoryContextEnabled: false,
      },
      update: { memoryContextEnabled: false },
    });
    await prisma.personalMemory.create({
      data: {
        userId: ownerId, kind: "CONFIRMED", content: "Do not share this without opt-in.",
        sourceType: "USER_STATEMENT", purpose: "Private preference",
        classification: "CONTEXTUAL", confirmedAt: new Date(),
      },
    });
    const run = await createRun({ idempotencyKey: `worker-memory-opt-out-${suffix}` });
    const provider = successfulProvider();

    await runAgentWorkerOnce({ prisma, provider, moderator: successfulModerator(), workerId: "worker-memory-opt-out" });

    const submitted = vi.mocked(provider.generatePlan).mock.calls[0][0].trustedContext;
    expect(submitted.personalMemory).toBeUndefined();
    expect(JSON.stringify(submitted)).not.toContain("Do not share this without opt-in.");
    const saved = await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(saved.status).toBe("PLANNED");
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

  it("blocks obvious credentials before sending task text to any provider", async () => {
    const run = await createRun({
      idempotencyKey: `worker-secret-screen-${suffix}`,
      task: "Use this password: my-private-password",
    });
    const provider = successfulProvider();
    const moderator = successfulModerator();

    const result = await runAgentWorkerOnce({ prisma, provider, moderator, workerId: "worker-secret-screen" });

    expect(result).toMatchObject({ status: "FAILED", code: "SENSITIVE_INPUT_BLOCKED" });
    expect(provider.generatePlan).not.toHaveBeenCalled();
    expect(moderator.moderate).not.toHaveBeenCalled();
    const saved = await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(saved.status).toBe("FAILED");
  });

  it("does not send generated suspected child-safety content to moderation", async () => {
    const run = await createRun({ idempotencyKey: `worker-output-child-safety-${suffix}` });
    const provider: AgentPlanProvider = {
      generatePlan: vi.fn(async () => ({ ...plan, summary: "CSAM material found." })),
    };
    const moderator = successfulModerator();

    const result = await runAgentWorkerOnce({ prisma, provider, moderator, workerId: "worker-output-child-safety" });

    expect(result).toMatchObject({ status: "FAILED", code: "SAFETY_REVIEW_REQUIRED" });
    expect(moderator.moderate).toHaveBeenCalledOnce();
    const saved = await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(saved.status).toBe("FAILED");
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
    await prisma.$transaction(async (tx) => {
      await tx.agentRun.updateMany({
        where: { id: run.id, status: "QUEUED" },
        data: { status: "CANCELLED", cancelledAt: new Date(), completedAt: new Date() },
      });
      await tx.permissionGrant.updateMany({
        where: { id: grantId, reservedUses: { gt: 0 } },
        data: { reservedUses: { decrement: 1 } },
      });
    });
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

  it("discards a provider result when a grant is revoked during planning", async () => {
    const run = await createRun({ idempotencyKey: `worker-revoked-during-plan-${suffix}` });
    const provider: AgentPlanProvider = {
      generatePlan: vi.fn(async () => {
        await prisma.permissionGrant.update({
          where: { id: grantId },
          data: { status: "REVOKED", revokedAt: new Date(), version: { increment: 1 } },
        });
        await prisma.agent.update({ where: { id: agentId }, data: { configurationVersion: { increment: 1 } } });
        return plan;
      }),
    };

    const result = await runAgentWorkerOnce({
      prisma,
      provider,
      moderator: successfulModerator(),
      workerId: "worker-revoked-during-plan",
    });

    expect(result).toMatchObject({ status: "CANCELLED", runId: run.id });
    const saved = await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(saved.status).toBe("CANCELLED");
    const grant = await prisma.permissionGrant.findUniqueOrThrow({ where: { id: grantId } });
    expect(grant.reservedUses).toBe(0);
    await prisma.permissionGrant.update({
      where: { id: grantId },
      data: { status: "ACTIVE", revokedAt: null, version: 1 },
    });
    await prisma.agent.update({ where: { id: agentId }, data: { configurationVersion: 1 } });
  });

  it("does not claim the same run concurrently while another worker holds its lease", async () => {
    const run = await createRun({ idempotencyKey: `worker-concurrency-${suffix}` });
    let resolvePlan!: (value: unknown) => void;
    const provider: AgentPlanProvider = {
      generatePlan: vi.fn(() => new Promise((resolve) => { resolvePlan = resolve; })),
    };
    const firstWorker = runAgentWorkerOnce({
      prisma,
      provider,
      moderator: successfulModerator(),
      workerId: "worker-first",
    });
    await vi.waitFor(() => expect(provider.generatePlan).toHaveBeenCalledOnce());

    const secondResult = await runAgentWorkerOnce({
      prisma,
      provider: successfulProvider(),
      moderator: successfulModerator(),
      workerId: "worker-second",
    });
    expect(secondResult).toEqual({ status: "IDLE" });
    resolvePlan(plan);
    const firstResult = await firstWorker;
    expect(firstResult).toMatchObject({ status: "PLANNED", runId: run.id });
  });

  it("purges expired queued runs, audits deletion, and releases reserved grants", async () => {
    const run = await createRun({ idempotencyKey: `worker-retention-${suffix}` });
    const expiredAt = new Date(Date.now() - 1_000);
    await prisma.agentRun.update({ where: { id: run.id }, data: { expiresAt: expiredAt } });

    const result = await purgeExpiredAgentRuns(prisma, new Date());

    expect(result).toMatchObject({ deleted: 1, cancelled: 1 });
    await expect(prisma.agentRun.findUnique({ where: { id: run.id } })).resolves.toBeNull();
    const grant = await prisma.permissionGrant.findUniqueOrThrow({ where: { id: grantId } });
    expect(grant.reservedUses).toBe(0);
    const audit = await prisma.auditEvent.findFirst({
      where: { agentId, targetId: run.id, action: "agent.run.expired" },
    });
    expect(audit).not.toBeNull();
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
