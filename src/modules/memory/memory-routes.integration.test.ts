import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { GET, POST } from "@/app/api/v1/me/memories/route";
import { DELETE, PATCH } from "@/app/api/v1/me/memories/[memoryId]/route";\nimport { purgeExpiredPersonalMemories } from "@/modules/runtime/retention";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("@/lib/request-security", () => ({ isTrustedMutationRequest: vi.fn(async () => true) }));

const enabled = process.env.RUN_DB_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;
const suffix = randomUUID();
const ownerId = `memory-owner-${suffix}`;
const otherId = `memory-other-${suffix}`;

function setSession(userId: string | null) {
  vi.mocked(auth.api.getSession).mockResolvedValue(
    userId ? ({ user: { id: userId } } as never) : null,
  );
}

function request(body: unknown) {
  return new Request("http://localhost/api/v1/me/memories", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify(body),
  });
}

suite("personal memory API (PostgreSQL integration)", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, name: "Memory Owner", email: `memory-owner-${suffix}@example.invalid` },
        { id: otherId, name: "Other Owner", email: `memory-other-${suffix}@example.invalid` },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
    vi.mocked(auth.api.getSession).mockReset();
  });

  it("requires authentication and stores only owner-confirmed records", async () => {
    setSession(null);
    expect((await GET()).status).toBe(401);

    setSession(ownerId);
    const response = await POST(request({
      kind: "CONFIRMED",
      content: "The owner prefers direct Arabic communication.",
      purpose: "Personalize agent responses",
      classification: "CONTEXTUAL",
    }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.kind).toBe("CONFIRMED");
    expect(body.data.sourceType).toBe("USER_STATEMENT");
    expect(body.data.confirmedAt).toBeTruthy();
  });

  it("does not expose another user's memories", async () => {
    setSession(ownerId);
    await POST(request({
      kind: "CONFIRMED",
      content: "Owner-only memory content.",
      purpose: "Private personalization",
      classification: "PRIVATE",
    }));
    setSession(otherId);
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toEqual([]);
  });

  it("requires an explicit owner confirmation before inferred memory becomes confirmed", async () => {
    const inferred = await prisma.personalMemory.create({
      data: {
        userId: ownerId,
        kind: "INFERRED",
        content: "The owner may prefer concise responses.",
        sourceType: "OBSERVED_PATTERN",
        confidence: 0.86,
        purpose: "Personalize communication",
        classification: "CONTEXTUAL",
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    setSession(ownerId);
    const response = await PATCH(
      new Request("http://localhost/api/v1/me/memories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: JSON.stringify({ confirm: true }),
      }),
      { params: Promise.resolve({ memoryId: inferred.id }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.kind).toBe("CONFIRMED");
    expect(body.data.sourceType).toBe("USER_CONFIRMED");
    expect(body.data.confidence).toBeNull();
  });

  it("does not let another user modify or delete an owner's memory", async () => {
    const memory = await prisma.personalMemory.create({
      data: {
        userId: ownerId,
        kind: "CONFIRMED",
        content: "Owner-only fact",
        sourceType: "USER_STATEMENT",
        purpose: "Personalize",
        classification: "CONTEXTUAL",
        confirmedAt: new Date(),
      },
    });
    setSession(otherId);
    const context = { params: Promise.resolve({ memoryId: memory.id }) };
    const patch = await PATCH(
      new Request("http://localhost/api/v1/me/memories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: JSON.stringify({ content: "attempted takeover" }),
      }),
      context,
    );
    const deletion = await DELETE(
      new Request("http://localhost/api/v1/me/memories", {
        method: "DELETE",
        headers: { Origin: "http://localhost" },
      }),
      context,
    );
    expect(patch.status).toBe(404);
    expect(deletion.status).toBe(404);
    expect((await prisma.personalMemory.findUnique({ where: { id: memory.id } }))?.content).toBe("Owner-only fact");
  });
});
