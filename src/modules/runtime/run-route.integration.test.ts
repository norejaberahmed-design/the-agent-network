import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { POST as createRun } from "../../app/api/v1/agents/[agentId]/runs/route";
import { POST as cancelRun } from "../../app/api/v1/agents/[agentId]/runs/[runId]/cancel/route";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
}));
vi.mock("@/lib/request-security", () => ({
  isTrustedMutationRequest: vi.fn(async () => true),
}));

const enabled = process.env.RUN_DB_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;
const suffix = randomUUID();
const ownerId = `run-owner-${suffix}`;
const outsiderId = `run-outsider-${suffix}`;
const agentId = `run-agent-${suffix}`;
const grantId = `run-grant-${suffix}`;
let queuedRunId = "";

const setSessionUser = (userId: string | null) => {
  vi.mocked(auth.api.getSession).mockResolvedValue(
    userId ? ({ user: { id: userId } } as never) : null,
  );
};
const context = (id: string) => ({ params: Promise.resolve({ agentId: id }) });
const payload = (overrides: Record<string, unknown> = {}) => ({
  task: "Search public supplier information and summarize sources.",
  purpose: "Research public suppliers for the owner.",
  target: "PUBLIC_WEB",
  idempotencyKey: `run-request-key-${suffix}`,
  ...overrides,
});
const request = (body: unknown) => new Request("http://localhost/api/v1/agents/runs", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "http://localhost" },
  body: JSON.stringify(body),
});

suite("agent run queue API (PostgreSQL integration)", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, name: "Run Owner", email: `run-owner-${suffix}@example.invalid` },
        { id: outsiderId, name: "Run Outsider", email: `run-outsider-${suffix}@example.invalid` },
      ],
    });
    await prisma.agent.create({
      data: {
        id: agentId,
        ownerType: "USER",
        userOwnerId: ownerId,
        name: "Run Test Agent",
        purpose: "Research public supplier information.",
        status: "ACTIVE",
        discoverable: false,
      },
    });
    await prisma.agentCapability.create({
      data: {
        agentId,
        key: "SEARCH_PUBLIC_WEB",
        description: "Search public web sources under an owner grant.",
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
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        maxUses: 1,
      },
    });
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { agentId } });
    await prisma.agentRun.deleteMany({ where: { agentId } });
    await prisma.permissionGrant.deleteMany({ where: { id: grantId } });
    await prisma.agentCapability.deleteMany({ where: { agentId } });
    await prisma.agent.deleteMany({ where: { id: agentId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, outsiderId] } } });
    vi.mocked(auth.api.getSession).mockReset();
  });

  it("requires authentication and denies users outside the owner boundary", async () => {
    setSessionUser(null);
    const unauthenticated = await createRun(request(payload()), context(agentId));
    expect(unauthenticated.status).toBe(401);

    setSessionUser(outsiderId);
    const outsider = await createRun(request(payload()), context(agentId));
    expect(outsider.status).toBe(403);
  });

  it("queues a run from server-derived capabilities and live grants, with idempotency and reservation", async () => {
    setSessionUser(ownerId);
    const first = await createRun(request(payload()), context(agentId));
    expect(first.status).toBe(202);
    const firstBody = await first.json();
    expect(firstBody.data).toMatchObject({
      status: "QUEUED",
      authorizedActions: ["SEARCH_PUBLIC_WEB"],
    });
    expect(firstBody.executionEnabled).toBe(false);
    queuedRunId = firstBody.data.id;

    const replay = await createRun(request(payload()), context(agentId));
    expect(replay.status).toBe(200);
    const replayBody = await replay.json();
    expect(replayBody.idempotentReplay).toBe(true);
    expect(replayBody.data.id).toBe(firstBody.data.id);

    const conflictingReplay = await createRun(
      request(payload({ task: "A different task with the same key." })),
      context(agentId),
    );
    expect(conflictingReplay.status).toBe(409);

    const overBudget = await createRun(
      request(payload({ idempotencyKey: `second-run-key-${suffix}` })),
      context(agentId),
    );
    expect(overBudget.status).toBe(403);

    const grant = await prisma.permissionGrant.findUniqueOrThrow({ where: { id: grantId } });
    expect(grant.reservedUses).toBe(1);
    expect(grant.uses).toBe(0);

    await expect(
      prisma.auditEvent.count({
        where: { agentId, action: "agent.run.queued", actorUserId: ownerId },
      }),
    ).resolves.toBe(1);
  });

  it("cancels a queued run and releases its reserved grant use", async () => {
    setSessionUser(ownerId);
    const response = await cancelRun(request({}), {
      params: Promise.resolve({ agentId, runId: queuedRunId }),
    });
    expect(response.status).toBe(200);
    await expect(
      prisma.permissionGrant.findUniqueOrThrow({ where: { id: grantId } }).then((grant) => grant.reservedUses),
    ).resolves.toBe(0);
    const replay = await cancelRun(request({}), {
      params: Promise.resolve({ agentId, runId: queuedRunId }),
    });
    expect(replay.status).toBe(409);
  });

  it("does not replay the same idempotency key across different agents", async () => {
    setSessionUser(ownerId);
    const secondAgentId = `run-agent-second-${suffix}`;
    try {
      await prisma.agent.create({
        data: {
          id: secondAgentId,
          ownerType: "USER",
          userOwnerId: ownerId,
          name: "Second Run Test Agent",
          purpose: "Research public supplier information.",
          status: "ACTIVE",
        },
      });
      const response = await createRun(request(payload()), context(secondAgentId));
      expect(response.status).toBe(409);
    } finally {
      await prisma.agent.deleteMany({ where: { id: secondAgentId } });
    }
  });
});
