import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { GET as getFieldPolicies, POST as upsertFieldPolicy } from "../../app/api/v1/agents/[agentId]/field-policies/route";
import { GET as getGrants, POST as createGrant } from "../../app/api/v1/agents/[agentId]/grants/route";
import { POST as revokeGrant } from "../../app/api/v1/agents/[agentId]/grants/[grantId]/revoke/route";

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
const ownerA = `policy-owner-a-${suffix}`;
const ownerB = `policy-owner-b-${suffix}`;
const viewerA = `policy-viewer-a-${suffix}`;
const outsider = `policy-outsider-${suffix}`;
const orgA = `policy-org-a-${suffix}`;
const orgB = `policy-org-b-${suffix}`;
const agentA = `policy-agent-a-${suffix}`;
const agentB = `policy-agent-b-${suffix}`;
const grantA = `policy-grant-a-${suffix}`;
const grantB = `policy-grant-b-${suffix}`;

const setSessionUser = (userId: string) => {
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: userId },
  } as never);
};

const contextForAgent = (agentId: string) => ({
  params: Promise.resolve({ agentId }),
});

const contextForGrant = (agentId: string, grantId: string) => ({
  params: Promise.resolve({ agentId, grantId }),
});

const jsonRequest = (url: string, body: unknown) =>
  new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify(body),
  });

suite("agent field-policy and permission-grant API boundaries (PostgreSQL integration)", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerA, name: "Policy Owner A", email: `policy-owner-a-${suffix}@example.invalid` },
        { id: ownerB, name: "Policy Owner B", email: `policy-owner-b-${suffix}@example.invalid` },
        { id: viewerA, name: "Policy Viewer A", email: `policy-viewer-a-${suffix}@example.invalid` },
        { id: outsider, name: "Policy Outsider", email: `policy-outsider-${suffix}@example.invalid` },
      ],
    });
    await prisma.organization.createMany({
      data: [
        { id: orgA, name: "Policy Organization A", slug: `policy-a-${suffix}` },
        { id: orgB, name: "Policy Organization B", slug: `policy-b-${suffix}` },
      ],
    });
    await prisma.membership.createMany({
      data: [
        { organizationId: orgA, userId: ownerA, role: "OWNER" },
        { organizationId: orgA, userId: viewerA, role: "VIEWER" },
        { organizationId: orgB, userId: ownerB, role: "OWNER" },
      ],
    });
    await prisma.agent.createMany({
      data: [
        {
          id: agentA,
          ownerType: "ORGANIZATION",
          organizationOwnerId: orgA,
          name: "Policy Agent A",
          purpose: "Tenant A policy and grant integration fixture",
        },
        {
          id: agentB,
          ownerType: "ORGANIZATION",
          organizationOwnerId: orgB,
          name: "Policy Agent B",
          purpose: "Tenant B policy and grant integration fixture",
        },
      ],
    });
    await prisma.agentFieldPolicy.create({
      data: {
        agentId: agentA,
        fieldKey: "purpose",
        classification: "PRIVATE",
        publicVisible: false,
      },
    });
    await prisma.permissionGrant.createMany({
      data: [
        {
          id: grantA,
          agentId: agentA,
          purpose: "Allow bounded public web search for integration tests",
          actionScope: ["SEARCH_PUBLIC_WEB"],
          targetScope: ["example.invalid"],
          dataScope: ["PUBLIC_PROFILE"],
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          maxUses: 2,
        },
        {
          id: grantB,
          agentId: agentB,
          purpose: "Cross-tenant grant isolation integration fixture",
          actionScope: ["SEARCH_PUBLIC_WEB"],
          targetScope: ["example.invalid"],
          dataScope: ["PUBLIC_PROFILE"],
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          maxUses: 2,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { agentId: { in: [agentA, agentB] } } });
    await prisma.agentFieldPolicy.deleteMany({ where: { agentId: { in: [agentA, agentB] } } });
    await prisma.permissionGrant.deleteMany({ where: { agentId: { in: [agentA, agentB] } } });
    await prisma.agent.deleteMany({ where: { id: { in: [agentA, agentB] } } });
    await prisma.membership.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerA, ownerB, viewerA, outsider] } } });
    vi.mocked(auth.api.getSession).mockReset();
  });

  it("denies outsiders access to field policies and grants", async () => {
    setSessionUser(outsider);
    const policies = await getFieldPolicies(new Request("http://localhost"), contextForAgent(agentA));
    const grants = await getGrants(new Request("http://localhost"), contextForAgent(agentA));
    expect(policies.status).toBe(403);
    expect(grants.status).toBe(403);
  });

  it("denies VIEWER access to private policy and grant management surfaces", async () => {
    setSessionUser(viewerA);
    const policies = await getFieldPolicies(new Request("http://localhost"), contextForAgent(agentA));
    const grants = await getGrants(new Request("http://localhost"), contextForAgent(agentA));
    const policyWrite = await upsertFieldPolicy(
      jsonRequest("http://localhost", {
        fieldKey: "purpose",
        classification: "PRIVATE",
        publicVisible: false,
      }),
      contextForAgent(agentA),
    );
    const grantWrite = await createGrant(
      jsonRequest("http://localhost", {
        purpose: "Create a bounded grant for integration testing",
        actionScope: ["SEARCH_PUBLIC_WEB"],
        targetScope: ["example.invalid"],
        dataScope: ["PUBLIC_PROFILE"],
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        maxUses: 1,
      }),
      contextForAgent(agentA),
    );
    const revoke = await revokeGrant(
      jsonRequest("http://localhost", {}),
      contextForGrant(agentA, grantA),
    );
    expect(policies.status).toBe(403);
    expect(grants.status).toBe(403);
    expect(policyWrite.status).toBe(403);
    expect(grantWrite.status).toBe(403);
    expect(revoke.status).toBe(403);
  });

  it("allows an OWNER to read and update a field policy and create a bounded grant", async () => {
    setSessionUser(ownerA);
    const policies = await getFieldPolicies(new Request("http://localhost"), contextForAgent(agentA));
    expect(policies.status).toBe(200);
    const policyWrite = await upsertFieldPolicy(
      jsonRequest("http://localhost", {
        fieldKey: "publicDescription",
        classification: "PUBLIC",
        publicVisible: true,
        allowedPurposes: [],
        allowedAudiences: [],
      }),
      contextForAgent(agentA),
    );
    expect(policyWrite.status).toBe(200);
    const policyPayload = await policyWrite.json();
    expect(policyPayload.data).toMatchObject({
      fieldKey: "publicDescription",
      classification: "PUBLIC",
      publicVisible: true,
      policyVersion: 1,
    });

    const grantWrite = await createGrant(
      jsonRequest("http://localhost", {
        purpose: "Create a bounded grant for integration testing",
        actionScope: ["SEARCH_PUBLIC_WEB"],
        targetScope: ["example.invalid"],
        dataScope: ["PUBLIC_PROFILE"],
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        maxUses: 1,
      }),
      contextForAgent(agentA),
    );
    expect(grantWrite.status).toBe(201);
    const grantPayload = await grantWrite.json();
    expect(grantPayload.executionEnabled).toBe(false);
    expect(grantPayload.data).toMatchObject({
      actionScope: ["SEARCH_PUBLIC_WEB"],
      targetScope: ["example.invalid"],
      dataScope: ["PUBLIC_PROFILE"],
      maxUses: 1,
      uses: 0,
      status: "ACTIVE",
    });
  });

  it("does not allow a grant from another tenant to be revoked through this agent ID", async () => {
    setSessionUser(ownerA);
    const response = await revokeGrant(
      jsonRequest("http://localhost", {}),
      contextForGrant(agentA, grantB),
    );
    expect(response.status).toBe(404);
    const untouched = await prisma.permissionGrant.findUniqueOrThrow({
      where: { id: grantB },
      select: { status: true, uses: true },
    });
    expect(untouched).toEqual({ status: "ACTIVE", uses: 0 });
  });

  it("allows the owning tenant to revoke its own grant and records the state change", async () => {
    setSessionUser(ownerA);
    const response = await revokeGrant(
      jsonRequest("http://localhost", {}),
      contextForGrant(agentA, grantA),
    );
    expect(response.status).toBe(200);
    const revoked = await prisma.permissionGrant.findUniqueOrThrow({
      where: { id: grantA },
      select: { status: true, revokedAt: true, version: true },
    });
    expect(revoked.status).toBe("REVOKED");
    expect(revoked.revokedAt).toBeInstanceOf(Date);
    expect(revoked.version).toBe(2);
    await expect(
      prisma.auditEvent.count({
        where: {
          agentId: agentA,
          action: "permission_grant.revoked",
          targetId: grantA,
          actorUserId: ownerA,
        },
      }),
    ).resolves.toBe(1);
  });
});
