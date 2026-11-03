import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { GET as disclosurePreview } from "../../app/api/v1/agents/[agentId]/disclosure-preview/route";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

const enabled = process.env.RUN_DB_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;
const suffix = randomUUID();
const ownerId = `disclosure-owner-${suffix}`;
const outsiderId = `disclosure-outsider-${suffix}`;
const agentId = `disclosure-agent-${suffix}`;

const setSessionUser = (userId: string | null) => {
  vi.mocked(auth.api.getSession).mockResolvedValue(
    userId ? ({ user: { id: userId } } as never) : null,
  );
};

const context = { params: Promise.resolve({ agentId }) };

suite("agent public disclosure preview API (PostgreSQL integration)", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        {
          id: ownerId,
          name: "Disclosure Preview Owner",
          email: `disclosure-owner-${suffix}@example.invalid`,
        },
        {
          id: outsiderId,
          name: "Disclosure Preview Outsider",
          email: `disclosure-outsider-${suffix}@example.invalid`,
        },
      ],
    });
    await prisma.agent.create({
      data: {
        id: agentId,
        ownerType: "USER",
        userOwnerId: ownerId,
        name: "Public Procurement Agent",
        publicDescription: "Helps discover approved suppliers.",
        purpose: "Internal target pricing and negotiation strategy.",
        status: "ACTIVE",
        discoverable: true,
      },
    });
    await prisma.agentFieldPolicy.createMany({
      data: [
        {
          agentId,
          fieldKey: "name",
          classification: "PUBLIC",
          publicVisible: true,
          allowedPurposes: ["PUBLIC_AGENT_DISCOVERY"],
          allowedAudiences: ["PUBLIC_NETWORK"],
        },
        {
          agentId,
          fieldKey: "publicDescription",
          classification: "PUBLIC",
          publicVisible: false,
        },
        {
          agentId,
          fieldKey: "purpose",
          classification: "PRIVATE",
          publicVisible: false,
          allowedPurposes: ["internal-procurement-review"],
          allowedAudiences: ["procurement-team"],
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.agent.deleteMany({ where: { id: agentId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, outsiderId] } } });
    vi.mocked(auth.api.getSession).mockReset();
  });

  it("rejects unauthenticated callers", async () => {
    setSessionUser(null);
    const response = await disclosurePreview(
      new Request("http://localhost"),
      context,
    );
    expect(response.status).toBe(401);
  });

  it("does not allow unrelated users to inspect the disclosure preview", async () => {
    setSessionUser(outsiderId);
    const response = await disclosurePreview(
      new Request("http://localhost"),
      context,
    );
    expect(response.status).toBe(403);
  });

  it("returns only fields allowed for the fixed public purpose and audience", async () => {
    setSessionUser(ownerId);
    const response = await disclosurePreview(
      new Request("http://localhost"),
      context,
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.profile).toEqual({
      name: "Public Procurement Agent",
    });
    expect(payload.data.profile).not.toHaveProperty("publicDescription");
    expect(payload.data.profile).not.toHaveProperty("purpose");
    expect(payload.data.readyForPublicDiscovery).toBe(true);
    expect(payload.data.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldKey: "publicDescription",
          included: false,
          reason: "NOT_PUBLIC",
        }),
        expect.objectContaining({
          fieldKey: "purpose",
          included: false,
          reason: "OWNER_APPROVAL_REQUIRED",
        }),
      ]),
    );
  });

  it("reports that a profile is not discoverable even when fields are public", async () => {
    setSessionUser(ownerId);
    await prisma.agent.update({
      where: { id: agentId },
      data: { discoverable: false },
    });
    const response = await disclosurePreview(
      new Request("http://localhost"),
      context,
    );
    const payload = await response.json();
    expect(payload.data.readyForPublicDiscovery).toBe(false);
    expect(payload.data.profile.name).toBe("Public Procurement Agent");
  });
});
