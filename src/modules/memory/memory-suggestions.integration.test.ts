import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { PATCH } from "@/app/api/v1/me/memory-suggestions/[suggestionId]/route";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("@/lib/request-security", () => ({ isTrustedMutationRequest: vi.fn(async () => true) }));

const enabled = process.env.RUN_DB_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;
const suffix = randomUUID();
const ownerId = "suggestion-owner-" + suffix;
const otherId = "suggestion-other-" + suffix;
const agentId = "suggestion-agent-" + suffix;

function setSession(userId: string) {
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: userId } } as never);
}

async function createSourceRun() {
  return prisma.agentRun.create({
    data: {
      agentId, requesterUserId: ownerId, ownerType: "USER", ownerId,
      task: "I prefer concise responses.", purpose: "Memory suggestion test", target: "PUBLIC_WEB",
      authorizedActions: [], grantIds: [], status: "PLANNED", requestDigest: "a".repeat(64),
      idempotencyKey: "suggestion-run-" + randomUUID(),
    },
  });
}

suite("owner memory suggestion review (PostgreSQL integration)", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, name: "Suggestion Owner", email: "suggestion-owner-" + suffix + "@example.invalid" },
        { id: otherId, name: "Suggestion Other", email: "suggestion-other-" + suffix + "@example.invalid" },
      ],
    });
    await prisma.agent.create({
      data: {
        id: agentId, ownerType: "USER", userOwnerId: ownerId,
        name: "Suggestion Review Agent", purpose: "Memory suggestion tests", status: "DRAFT",
      },
    });
  });

  afterAll(async () => {
    await prisma.agent.deleteMany({ where: { id: agentId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
    vi.mocked(auth.api.getSession).mockReset();
  });

  it("accepts an edited suggestion and creates confirmed memory with source provenance", async () => {
    const run = await createSourceRun();
    const suggestion = await prisma.memorySuggestion.create({
      data: {
        userId: ownerId, sourceRunId: run.id,
        content: "The owner prefers concise responses.",
        evidenceExcerpt: "I prefer concise responses",
        confidence: 0.9, dedupeKey: randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64),
      },
    });
    setSession(ownerId);
    const response = await PATCH(
      new Request("http://localhost/api/v1/me/memory-suggestions/" + suggestion.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: JSON.stringify({ action: "ACCEPT", version: 1, content: "The owner prefers concise Arabic responses." }),
      }),
      { params: Promise.resolve({ suggestionId: suggestion.id }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.status).toBe("ACCEPTED");
    expect(body.data.memory).toMatchObject({
      kind: "CONFIRMED",
      sourceType: "USER_CONFIRMED",
      content: "The owner prefers concise Arabic responses.",
      sourceReference: "AgentRun:" + run.id,
    });
    expect(await prisma.memorySuggestion.findUniqueOrThrow({ where: { id: suggestion.id } })).toMatchObject({ status: "ACCEPTED", version: 2 });
  });

  it("prevents another account from accepting or rejecting the suggestion", async () => {
    const run = await createSourceRun();
    const suggestion = await prisma.memorySuggestion.create({
      data: {
        userId: ownerId, sourceRunId: run.id,
        content: "The owner prefers concise responses.",
        evidenceExcerpt: "I prefer concise responses",
        confidence: 0.9, dedupeKey: randomUUID().replaceAll("-", "").padEnd(64, "1").slice(0, 64),
      },
    });
    setSession(otherId);
    const response = await PATCH(
      new Request("http://localhost/api/v1/me/memory-suggestions/" + suggestion.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: JSON.stringify({ action: "ACCEPT", version: 1 }),
      }),
      { params: Promise.resolve({ suggestionId: suggestion.id }) },
    );
    expect(response.status).toBe(409);
    expect(await prisma.memorySuggestion.findUniqueOrThrow({ where: { id: suggestion.id } })).toMatchObject({ status: "PENDING", version: 1 });
  });

  it("rejects stale review versions and does not create a memory", async () => {
    const run = await createSourceRun();
    const suggestion = await prisma.memorySuggestion.create({
      data: {
        userId: ownerId, sourceRunId: run.id,
        content: "The owner prefers concise responses.",
        evidenceExcerpt: "I prefer concise responses",
        confidence: 0.9, dedupeKey: randomUUID().replaceAll("-", "").padEnd(64, "2").slice(0, 64),
      },
    });
    setSession(ownerId);
    const response = await PATCH(
      new Request("http://localhost/api/v1/me/memory-suggestions/" + suggestion.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: JSON.stringify({ action: "REJECT", version: 99 }),
      }),
      { params: Promise.resolve({ suggestionId: suggestion.id }) },
    );
    expect(response.status).toBe(409);
    expect(await prisma.personalMemory.count({ where: { userId: ownerId, sourceReference: "AgentRun:" + run.id } })).toBe(0);
  });
});
