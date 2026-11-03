import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { GET as listDiscoverableAgents } from "../../app/api/v1/discovery/agents/route";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

const enabled = process.env.RUN_DB_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;
const suffix = randomUUID();
const ownerId = `discovery-owner-${suffix}`;
const viewerId = `discovery-viewer-${suffix}`;
const publicAgentId = `discovery-public-${suffix}`;
const noPolicyAgentId = `discovery-no-policy-${suffix}`;
const draftAgentId = `discovery-draft-${suffix}`;
const privateAgentId = `discovery-private-${suffix}`;

const setSessionUser = (userId: string | null) => {
  vi.mocked(auth.api.getSession).mockResolvedValue(
    userId ? ({ user: { id: userId } } as never) : null,
  );
};

suite("authenticated public agent discovery (PostgreSQL integration)", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        {
          id: ownerId,
          name: "Discovery Agent Owner",
          email: `discovery-owner-${suffix}@example.invalid`,
        },
        {
          id: viewerId,
          name: "Discovery Directory Viewer",
          email: `discovery-viewer-${suffix}@example.invalid`,
        },
      ],
    });

    await prisma.agent.createMany({
      data: [
        {
          id: publicAgentId,
          ownerType: "USER",
          userOwnerId: ownerId,
          name: "Supplier Discovery Agent",
          publicDescription: "Finds approved public supplier information.",
          purpose: "Private negotiation and target pricing.",
          status: "ACTIVE",
          discoverable: true,
        },
        {
          id: noPolicyAgentId,
          ownerType: "USER",
          userOwnerId: ownerId,
          name: "Unclassified Agent",
          purpose: "Private agent without disclosure policies.",
          status: "ACTIVE",
          discoverable: true,
        },
        {
          id: draftAgentId,
          ownerType: "USER",
          userOwnerId: ownerId,
          name: "Draft Agent",
          purpose: "Not yet active.",
          status: "DRAFT",
          discoverable: true,
        },
        {
          id: privateAgentId,
          ownerType: "USER",
          userOwnerId: ownerId,
          name: "Private Agent",
          purpose: "Never shown in discovery.",
          status: "ACTIVE",
          discoverable: false,
        },
      ],
    });

    await prisma.agentFieldPolicy.createMany({
      data: [
        {
          agentId: publicAgentId,
          fieldKey: "name",
          classification: "PUBLIC",
          publicVisible: true,
          allowedPurposes: ["PUBLIC_AGENT_DISCOVERY"],
          allowedAudiences: ["PUBLIC_NETWORK"],
        },
        {
          agentId: publicAgentId,
          fieldKey: "publicDescription",
          classification: "PUBLIC",
          publicVisible: true,
          allowedPurposes: ["PUBLIC_AGENT_DISCOVERY"],
          allowedAudiences: ["VERIFIED_ONLY"],
        },
        {
          agentId: publicAgentId,
          fieldKey: "purpose",
          classification: "PRIVATE",
          publicVisible: false,
          allowedPurposes: ["internal-review"],
          allowedAudiences: ["owner"],
        },
        {
          agentId: draftAgentId,
          fieldKey: "name",
          classification: "PUBLIC",
          publicVisible: true,
        },
        {
          agentId: privateAgentId,
          fieldKey: "name",
          classification: "PUBLIC",
          publicVisible: true,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.agent.deleteMany({
      where: { id: { in: [publicAgentId, noPolicyAgentId, draftAgentId, privateAgentId] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, viewerId] } } });
    vi.mocked(auth.api.getSession).mockReset();
  });

  it("requires an authenticated account", async () => {
    setSessionUser(null);
    const response = await listDiscoverableAgents(new Request("http://localhost/api/v1/discovery/agents"));
    expect(response.status).toBe(401);
  });

  it("returns only active discoverable agents and only their explicitly permitted public fields", async () => {
    setSessionUser(viewerId);
    const response = await listDiscoverableAgents(
      new Request("http://localhost/api/v1/discovery/agents"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const payload = await response.json();
    const publicResult = payload.data.find(
      (item: { id: string }) => item.id === publicAgentId,
    );
    expect(publicResult).toEqual({
      id: publicAgentId,
      profile: { name: "Supplier Discovery Agent" },
    });
    expect(payload.data.some((item: { id: string }) =>
      [noPolicyAgentId, draftAgentId, privateAgentId].includes(item.id),
    )).toBe(false);
    expect(JSON.stringify(publicResult)).not.toContain("Private negotiation");
    expect(JSON.stringify(publicResult)).not.toContain("approved public supplier information");
  });
});
