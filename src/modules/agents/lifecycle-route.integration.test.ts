import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { PATCH as updateLifecycle } from "../../app/api/v1/agents/[agentId]/lifecycle/route";

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
const ownerId = `lifecycle-owner-${suffix}`;
const outsiderId = `lifecycle-outsider-${suffix}`;
const orgOwnerId = `lifecycle-org-owner-${suffix}`;
const orgAdminId = `lifecycle-org-admin-${suffix}`;
const orgManagerId = `lifecycle-org-manager-${suffix}`;
const organizationId = `lifecycle-org-${suffix}`;
const personalAgentId = `lifecycle-personal-agent-${suffix}`;
const organizationAgentId = `lifecycle-organization-agent-${suffix}`;
const revokedAgentId = `lifecycle-revoked-agent-${suffix}`;

const setSessionUser = (userId: string | null) => {
  vi.mocked(auth.api.getSession).mockResolvedValue(
    userId ? ({ user: { id: userId } } as never) : null,
  );
};

const context = (agentId: string) => ({ params: Promise.resolve({ agentId }) });
const patchRequest = (body: unknown) =>
  new Request("http://localhost/api/v1/agents/lifecycle", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify(body),
  });

suite("agent lifecycle and discovery activation (PostgreSQL integration)", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, name: "Lifecycle Owner", email: `life-owner-${suffix}@example.invalid` },
        { id: outsiderId, name: "Lifecycle Outsider", email: `life-outsider-${suffix}@example.invalid` },
        { id: orgOwnerId, name: "Lifecycle Org Owner", email: `life-org-owner-${suffix}@example.invalid` },
        { id: orgAdminId, name: "Lifecycle Org Admin", email: `life-org-admin-${suffix}@example.invalid` },
        { id: orgManagerId, name: "Lifecycle Org Manager", email: `life-org-manager-${suffix}@example.invalid` },
      ],
    });
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Lifecycle Test Organization",
        slug: `lifecycle-${suffix}`,
      },
    });
    await prisma.membership.createMany({
      data: [
        { organizationId, userId: orgOwnerId, role: "OWNER" },
        { organizationId, userId: orgAdminId, role: "ADMIN" },
        { organizationId, userId: orgManagerId, role: "AGENT_MANAGER" },
      ],
    });
    await prisma.agent.createMany({
      data: [
        {
          id: personalAgentId,
          ownerType: "USER",
          userOwnerId: ownerId,
          name: "Lifecycle Personal Agent",
          purpose: "Internal personal workflow.",
          status: "DRAFT",
          discoverable: false,
        },
        {
          id: organizationAgentId,
          ownerType: "ORGANIZATION",
          organizationOwnerId: organizationId,
          name: "Lifecycle Organization Agent",
          purpose: "Internal organization workflow.",
          status: "DRAFT",
          discoverable: false,
        },
        {
          id: revokedAgentId,
          ownerType: "USER",
          userOwnerId: ownerId,
          name: "Revoked Lifecycle Agent",
          purpose: "Terminal state fixture.",
          status: "REVOKED",
          discoverable: false,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({
      where: {
        OR: [
          { agentId: { in: [personalAgentId, organizationAgentId, revokedAgentId] } },
          { ownerId: organizationId },
        ],
      },
    });
    await prisma.agent.deleteMany({
      where: { id: { in: [personalAgentId, organizationAgentId, revokedAgentId] } },
    });
    await prisma.membership.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerId, outsiderId, orgOwnerId, orgAdminId, orgManagerId] } },
    });
    vi.mocked(auth.api.getSession).mockReset();
  });

  it("requires authentication and ownership or organization-admin authority", async () => {
    setSessionUser(null);
    const unauthenticated = await updateLifecycle(
      patchRequest({ status: "ACTIVE", discoverable: false }),
      context(personalAgentId),
    );
    expect(unauthenticated.status).toBe(401);

    setSessionUser(outsiderId);
    const outsider = await updateLifecycle(
      patchRequest({ status: "ACTIVE", discoverable: false }),
      context(personalAgentId),
    );
    expect(outsider.status).toBe(403);
    const revokedOutsider = await updateLifecycle(
      patchRequest({ status: "ACTIVE", discoverable: false }),
      context(revokedAgentId),
    );
    expect(revokedOutsider.status).toBe(403);

    setSessionUser(orgManagerId);
    const manager = await updateLifecycle(
      patchRequest({ status: "ACTIVE", discoverable: false }),
      context(organizationAgentId),
    );
    expect(manager.status).toBe(403);
  });

  it("refuses public discovery until at least one field is explicitly public", async () => {
    setSessionUser(ownerId);
    const response = await updateLifecycle(
      patchRequest({ status: "ACTIVE", discoverable: true }),
      context(personalAgentId),
    );
    expect(response.status).toBe(422);

    const agent = await prisma.agent.findUniqueOrThrow({
      where: { id: personalAgentId },
      select: { status: true, discoverable: true, configurationVersion: true },
    });
    expect(agent).toMatchObject({
      status: "DRAFT",
      discoverable: false,
      configurationVersion: 1,
    });
  });

  it("allows an owner to activate privately and then publish only after public policy approval", async () => {
    setSessionUser(ownerId);
    const activatePrivate = await updateLifecycle(
      patchRequest({ status: "ACTIVE", discoverable: false }),
      context(personalAgentId),
    );
    expect(activatePrivate.status).toBe(200);

    await prisma.agentFieldPolicy.create({
      data: {
        agentId: personalAgentId,
        fieldKey: "name",
        classification: "PUBLIC",
        publicVisible: true,
        allowedPurposes: ["PUBLIC_AGENT_DISCOVERY"],
        allowedAudiences: ["PUBLIC_NETWORK"],
      },
    });

    const publish = await updateLifecycle(
      patchRequest({ status: "ACTIVE", discoverable: true }),
      context(personalAgentId),
    );
    expect(publish.status).toBe(200);
    const agent = await prisma.agent.findUniqueOrThrow({
      where: { id: personalAgentId },
      select: { status: true, discoverable: true, configurationVersion: true },
    });
    expect(agent).toMatchObject({
      status: "ACTIVE",
      discoverable: true,
      configurationVersion: 3,
    });
    await expect(
      prisma.auditEvent.count({
        where: {
          agentId: personalAgentId,
          action: "agent.lifecycle.updated",
          actorUserId: ownerId,
        },
      }),
    ).resolves.toBe(2);
  });

  it("allows an organization admin to pause an agent and forces discoverability off", async () => {
    setSessionUser(orgAdminId);
    const activate = await updateLifecycle(
      patchRequest({ status: "ACTIVE", discoverable: false }),
      context(organizationAgentId),
    );
    expect(activate.status).toBe(200);

    const grantId = `lifecycle-pause-grant-${suffix}`;
    const runId = `lifecycle-pause-run-${suffix}`;
    await prisma.agentCapability.create({
      data: { agentId: organizationAgentId, key: "SEARCH_PUBLIC_WEB", description: "Search.", languages: ["en"] },
    });
    await prisma.permissionGrant.create({
      data: {
        id: grantId,
        agentId: organizationAgentId,
        purpose: "Research public suppliers for the owner.",
        actionScope: ["SEARCH_PUBLIC_WEB"],
        targetScope: ["PUBLIC_WEB"],
        dataScope: ["PUBLIC_PROFILE"],
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        maxUses: 1,
        reservedUses: 1,
      },
    });
    await prisma.agentRun.create({
      data: {
        id: runId,
        agentId: organizationAgentId,
        requesterUserId: orgAdminId,
        ownerType: "ORGANIZATION",
        ownerId: organizationId,
        task: "Research public supplier information.",
        purpose: "Research public suppliers for the owner.",
        target: "PUBLIC_WEB",
        authorizedActions: ["SEARCH_PUBLIC_WEB"],
        grantIds: [grantId],
        requestDigest: "d".repeat(64),
        idempotencyKey: `lifecycle-pause-key-${suffix}`,
        status: "CLAIMED",
        workerId: "test-worker-001",
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    const pause = await updateLifecycle(
      patchRequest({ status: "PAUSED", discoverable: false }),
      context(organizationAgentId),
    );
    expect(pause.status).toBe(200);
    const agent = await prisma.agent.findUniqueOrThrow({
      where: { id: organizationAgentId },
      select: { status: true, discoverable: true },
    });
    expect(agent).toEqual({ status: "PAUSED", discoverable: false });
    const cancelledRun = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect(cancelledRun).toMatchObject({ status: "CANCELLED", errorCode: "AGENT_NOT_ACTIVE", workerId: null });
    const releasedGrant = await prisma.permissionGrant.findUniqueOrThrow({ where: { id: grantId } });
    expect(releasedGrant.reservedUses).toBe(0);
  });

  it("rejects invalid lifecycle states and inconsistent discoverability", async () => {
    setSessionUser(ownerId);
    const revoked = await updateLifecycle(
      patchRequest({ status: "REVOKED", discoverable: false }),
      context(personalAgentId),
    );
    const draftPublic = await updateLifecycle(
      patchRequest({ status: "DRAFT", discoverable: true }),
      context(personalAgentId),
    );
    const reactivateRevoked = await updateLifecycle(
      patchRequest({ status: "ACTIVE", discoverable: false }),
      context(revokedAgentId),
    );
    expect(revoked.status).toBe(422);
    expect(draftPublic.status).toBe(422);
    expect(reactivateRevoked.status).toBe(409);
  });
});
