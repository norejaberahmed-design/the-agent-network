import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { GET as listMembers } from "../../app/api/v1/organizations/[organizationId]/members/route";
import { POST as createOrganizationInvitation } from "../../app/api/v1/organizations/[organizationId]/invitations/route";
import {
  PATCH as updateMember,
  DELETE as removeMember,
} from "../../app/api/v1/organizations/[organizationId]/members/[membershipId]/route";

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
const ownerId = `org-owner-${suffix}`;
const adminId = `org-admin-${suffix}`;
const secondAdminId = `org-second-admin-${suffix}`;
const managerId = `org-manager-${suffix}`;
const viewerId = `org-viewer-${suffix}`;
const outsiderId = `org-outsider-${suffix}`;
const otherMemberId = `org-other-member-${suffix}`;
const organizationId = `org-members-${suffix}`;
const otherOrganizationId = `org-other-members-${suffix}`;
const membershipAgentId = `membership-agent-${suffix}`;
const membershipGrantId = `membership-grant-${suffix}`;
const membershipRunId = `membership-run-${suffix}`;
let ownerMembershipId = "";
let adminMembershipId = "";
let secondAdminMembershipId = "";
let managerMembershipId = "";
let viewerMembershipId = "";
let otherMembershipId = "";
let adminInvitationId = "";

const setSessionUser = (userId: string) => {
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: userId },
  } as never);
};

const contextForOrganization = (organizationId: string) => ({
  params: Promise.resolve({ organizationId }),
});

const contextForMember = (organizationId: string, membershipId: string) => ({
  params: Promise.resolve({ organizationId, membershipId }),
});

const request = (url: string, method: string, body?: unknown) =>
  new Request(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

suite("organization membership management APIs (PostgreSQL integration)", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, name: "Organization Owner", email: `owner-${suffix}@example.invalid` },
        { id: adminId, name: "Organization Admin", email: `admin-${suffix}@example.invalid` },
        { id: secondAdminId, name: "Second Organization Admin", email: `admin2-${suffix}@example.invalid` },
        { id: managerId, name: "Organization Manager", email: `manager-${suffix}@example.invalid` },
        { id: viewerId, name: "Organization Viewer", email: `viewer-${suffix}@example.invalid` },
        { id: outsiderId, name: "Organization Outsider", email: `outsider-${suffix}@example.invalid` },
        { id: otherMemberId, name: "Other Tenant Member", email: `other-${suffix}@example.invalid` },
      ],
    });
    await prisma.organization.createMany({
      data: [
        { id: organizationId, name: "Membership Test Organization", slug: `members-${suffix}` },
        { id: otherOrganizationId, name: "Other Tenant Organization", slug: `other-members-${suffix}` },
      ],
    });
    const memberships = await Promise.all([
      prisma.membership.create({ data: { organizationId, userId: ownerId, role: "OWNER" } }),
      prisma.membership.create({ data: { organizationId, userId: adminId, role: "ADMIN" } }),
      prisma.membership.create({ data: { organizationId, userId: secondAdminId, role: "ADMIN" } }),
      prisma.membership.create({ data: { organizationId, userId: managerId, role: "AGENT_MANAGER" } }),
      prisma.membership.create({ data: { organizationId, userId: viewerId, role: "VIEWER" } }),
      prisma.membership.create({ data: { organizationId: otherOrganizationId, userId: otherMemberId, role: "VIEWER" } }),
    ]);
    [
      ownerMembershipId,
      adminMembershipId,
      secondAdminMembershipId,
      managerMembershipId,
      viewerMembershipId,
      otherMembershipId,
    ] = memberships.map((membership) => membership.id);
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({
      where: {
        ownerType: "ORGANIZATION",
        ownerId: { in: [organizationId, otherOrganizationId] },
      },
    });
    await prisma.agent.deleteMany({ where: { id: membershipAgentId } });
    await prisma.invitation.deleteMany({
      where: { organizationId: { in: [organizationId, otherOrganizationId] } },
    });
    await prisma.membership.deleteMany({
      where: { organizationId: { in: [organizationId, otherOrganizationId] } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [organizationId, otherOrganizationId] } },
    });
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [ownerId, adminId, secondAdminId, managerId, viewerId, outsiderId, otherMemberId],
        },
      },
    });
    vi.mocked(auth.api.getSession).mockReset();
  });

  it("restricts member directory access to organization owners and admins", async () => {
    setSessionUser(outsiderId);
    const outsiderResponse = await listMembers(
      new Request("http://localhost"),
      contextForOrganization(organizationId),
    );
    expect(outsiderResponse.status).toBe(403);

    setSessionUser(managerId);
    const managerResponse = await listMembers(
      new Request("http://localhost"),
      contextForOrganization(organizationId),
    );
    expect(managerResponse.status).toBe(403);

    setSessionUser(ownerId);
    const ownerResponse = await listMembers(
      new Request("http://localhost"),
      contextForOrganization(organizationId),
    );
    expect(ownerResponse.status).toBe(200);
    const payload = await ownerResponse.json();
    expect(payload.data).toHaveLength(5);
    expect(payload.data.some((item: { user: { email: string } }) =>
      item.user.email === `viewer-${suffix}@example.invalid`,
    )).toBe(true);
  });

  it("allows owners to invite admins and admins to invite only lower-privilege roles", async () => {
    setSessionUser(ownerId);
    const ownerInvite = await createOrganizationInvitation(
      request("http://localhost", "POST", {
        email: "new-admin@example.invalid",
        role: "ADMIN",
        expiresInHours: 24,
      }),
      contextForOrganization(organizationId),
    );
    expect(ownerInvite.status).toBe(201);
    const ownerPayload = await ownerInvite.json();
    expect(ownerPayload.data.role).toBe("ADMIN");
    const ownerTokenHash = createHash("sha256")
      .update(ownerPayload.data.token)
      .digest("hex");
    const storedOwnerInvite = await prisma.invitation.findUniqueOrThrow({
      where: { id: ownerPayload.data.id },
    });
    expect(storedOwnerInvite.tokenHash).toBe(ownerTokenHash);

    setSessionUser(adminId);
    const adminInvite = await createOrganizationInvitation(
      request("http://localhost", "POST", {
        email: "new-viewer@example.invalid",
        role: "VIEWER",
        expiresInHours: 48,
      }),
      contextForOrganization(organizationId),
    );
    expect(adminInvite.status).toBe(201);
    const adminInvitePayload = await adminInvite.json();
    adminInvitationId = adminInvitePayload.data.id;

    const adminElevation = await createOrganizationInvitation(
      request("http://localhost", "POST", {
        email: "new-admin-two@example.invalid",
        role: "ADMIN",
      }),
      contextForOrganization(organizationId),
    );
    expect(adminElevation.status).toBe(403);

    setSessionUser(managerId);
    const managerInvite = await createOrganizationInvitation(
      request("http://localhost", "POST", {
        email: "manager-invite@example.invalid",
        role: "VIEWER",
      }),
      contextForOrganization(organizationId),
    );
    expect(managerInvite.status).toBe(403);
  });

  it("allows admins to change lower-privilege member roles and records audit evidence", async () => {
    setSessionUser(adminId);
    const response = await updateMember(
      request("http://localhost", "PATCH", { role: "OPERATOR" }),
      contextForMember(organizationId, viewerMembershipId),
    );
    expect(response.status).toBe(200);
    const stored = await prisma.membership.findUniqueOrThrow({
      where: { id: viewerMembershipId },
    });
    expect(stored.role).toBe("OPERATOR");
    await expect(
      prisma.auditEvent.count({
        where: {
          ownerId: organizationId,
          action: "organization.member.role_changed",
          targetId: viewerMembershipId,
          actorUserId: adminId,
        },
      }),
    ).resolves.toBe(1);
  });

  it("prevents admins from modifying admins or elevating a member to admin", async () => {
    setSessionUser(adminId);
    const modifyAdmin = await updateMember(
      request("http://localhost", "PATCH", { role: "VIEWER" }),
      contextForMember(organizationId, secondAdminMembershipId),
    );
    const promote = await updateMember(
      request("http://localhost", "PATCH", { role: "ADMIN" }),
      contextForMember(organizationId, managerMembershipId),
    );
    expect(modifyAdmin.status).toBe(403);
    expect(promote.status).toBe(403);
  });

  it("protects owner membership and rejects cross-tenant membership identifiers", async () => {
    setSessionUser(ownerId);
    const ownerChange = await updateMember(
      request("http://localhost", "PATCH", { role: "VIEWER" }),
      contextForMember(organizationId, ownerMembershipId),
    );
    const ownerRemoval = await removeMember(
      request("http://localhost", "DELETE"),
      contextForMember(organizationId, ownerMembershipId),
    );
    const crossTenant = await updateMember(
      request("http://localhost", "PATCH", { role: "OPERATOR" }),
      contextForMember(organizationId, otherMembershipId),
    );
    const ownerPromotion = await updateMember(
      request("http://localhost", "PATCH", { role: "OWNER" }),
      contextForMember(organizationId, viewerMembershipId),
    );
    expect(ownerChange.status).toBe(403);
    expect(ownerRemoval.status).toBe(403);
    expect(crossTenant.status).toBe(404);
    expect(ownerPromotion.status).toBe(422);
  });

  it("allows owners to remove non-owner members with an audit event", async () => {
    setSessionUser(ownerId);
    const response = await removeMember(
      request("http://localhost", "DELETE"),
      contextForMember(organizationId, managerMembershipId),
    );
    expect(response.status).toBe(200);
    await expect(
      prisma.membership.findUnique({ where: { id: managerMembershipId } }),
    ).resolves.toBeNull();
    await expect(
      prisma.auditEvent.count({
        where: {
          ownerId: organizationId,
          action: "organization.member.removed",
          targetId: managerMembershipId,
          actorUserId: ownerId,
        },
      }),
    ).resolves.toBe(1);
  });

  it("does not allow an admin to remove another admin", async () => {
    setSessionUser(adminId);
    const response = await removeMember(
      request("http://localhost", "DELETE"),
      contextForMember(organizationId, secondAdminMembershipId),
    );
    expect(response.status).toBe(403);
  });
  it("revokes invitations and cancels queued runs when the owner removes that member", async () => {
    await prisma.agent.create({
      data: {
        id: membershipAgentId,
        ownerType: "ORGANIZATION",
        organizationOwnerId: organizationId,
        name: "Membership Runtime Agent",
        purpose: "Research public supplier information.",
        status: "ACTIVE",
      },
    });
    await prisma.permissionGrant.create({
      data: {
        id: membershipGrantId,
        agentId: membershipAgentId,
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
        id: membershipRunId,
        agentId: membershipAgentId,
        requesterUserId: adminId,
        ownerType: "ORGANIZATION",
        ownerId: organizationId,
        task: "Research public supplier information.",
        purpose: "Research public suppliers for the owner.",
        target: "PUBLIC_WEB",
        authorizedActions: ["SEARCH_PUBLIC_WEB"],
        grantIds: [membershipGrantId],
        requestDigest: "e".repeat(64),
        idempotencyKey: `membership-run-key-${suffix}`,
        status: "QUEUED",
      },
    });
    setSessionUser(ownerId);
    const response = await removeMember(
      request("http://localhost", "DELETE"),
      contextForMember(organizationId, adminMembershipId),
    );
    expect(response.status).toBe(200);

    const invitation = await prisma.invitation.findUniqueOrThrow({
      where: { id: adminInvitationId },
      select: { status: true, reservationId: true, reservationExpiresAt: true },
    });
    expect(invitation).toEqual({
      status: "REVOKED",
      reservationId: null,
      reservationExpiresAt: null,
    });
    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: membershipRunId } });
    expect(run).toMatchObject({ status: "CANCELLED", errorCode: "REQUESTER_ACCESS_REVOKED" });
    const grant = await prisma.permissionGrant.findUniqueOrThrow({ where: { id: membershipGrantId } });
    expect(grant.reservedUses).toBe(0);
    await expect(
      prisma.auditEvent.count({
        where: {
          ownerId: organizationId,
          action: "organization.member.invitations_revoked",
          targetId: adminMembershipId,
          actorUserId: ownerId,
        },
      }),
    ).resolves.toBe(1);
  });

});
