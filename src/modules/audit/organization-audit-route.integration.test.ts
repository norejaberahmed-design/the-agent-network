import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { GET as listOrganizationAuditEvents } from "../../app/api/v1/organizations/[organizationId]/audit-events/route";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

const enabled = process.env.RUN_DB_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;
const suffix = randomUUID();
const ownerId = `audit-owner-${suffix}`;
const auditorId = `audit-auditor-${suffix}`;
const viewerId = `audit-viewer-${suffix}`;
const outsiderId = `audit-outsider-${suffix}`;
const organizationId = `audit-org-${suffix}`;
const otherOrganizationId = `audit-other-org-${suffix}`;
let otherTenantEventId = "";

const setSessionUser = (userId: string | null) => {
  vi.mocked(auth.api.getSession).mockResolvedValue(
    userId ? ({ user: { id: userId } } as never) : null,
  );
};

const context = (organizationId: string) => ({
  params: Promise.resolve({ organizationId }),
});

suite("organization audit event API (PostgreSQL integration)", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, name: "Audit Owner", email: `audit-owner-${suffix}@example.invalid` },
        { id: auditorId, name: "Audit Reviewer", email: `audit-reviewer-${suffix}@example.invalid` },
        { id: viewerId, name: "Audit Viewer", email: `audit-viewer-${suffix}@example.invalid` },
        { id: outsiderId, name: "Audit Outsider", email: `audit-outsider-${suffix}@example.invalid` },
      ],
    });
    await prisma.organization.createMany({
      data: [
        { id: organizationId, name: "Audit Test Organization", slug: `audit-${suffix}` },
        { id: otherOrganizationId, name: "Other Audit Organization", slug: `audit-other-${suffix}` },
      ],
    });
    await prisma.membership.createMany({
      data: [
        { organizationId, userId: ownerId, role: "OWNER" },
        { organizationId, userId: auditorId, role: "AUDITOR" },
        { organizationId, userId: viewerId, role: "VIEWER" },
      ],
    });
    await prisma.auditEvent.createMany({
      data: [
        {
          actorUserId: ownerId,
          ownerType: "ORGANIZATION",
          ownerId: organizationId,
          action: "agent.lifecycle.updated",
          targetType: "Agent",
          targetId: "audit-agent-1",
          outcome: "COMPLETED",
          correlationId: `audit-life-${suffix}`,
          occurredAt: new Date("2026-01-01T00:00:00.000Z"),
          metadata: {
            previousStatus: "DRAFT",
            newStatus: "ACTIVE",
            previousDiscoverable: false,
            newDiscoverable: true,
            purpose: "private internal strategy",
            token: "never-return-this",
          },
        },
        {
          actorUserId: auditorId,
          ownerType: "ORGANIZATION",
          ownerId: organizationId,
          action: "invitation.created",
          targetType: "Invitation",
          targetId: "audit-invitation-1",
          outcome: "COMPLETED",
          correlationId: `audit-invite-${suffix}`,
          occurredAt: new Date("2026-01-02T00:00:00.000Z"),
          metadata: {
            intendedEmail: "private-person@example.invalid",
            role: "VIEWER",
            expiresAt: "2026-01-05T00:00:00.000Z",
            token: "never-return-this-either",
          },
        },
        {
          actorUserId: ownerId,
          ownerType: "ORGANIZATION",
          ownerId: otherOrganizationId,
          action: "agent.created",
          targetType: "Agent",
          targetId: "other-tenant-agent",
          outcome: "COMPLETED",
          correlationId: `audit-other-${suffix}`,
          occurredAt: new Date("2026-01-03T00:00:00.000Z"),
          metadata: { initialStatus: "DRAFT" },
        },
      ],
    });
    const otherEvent = await prisma.auditEvent.findFirstOrThrow({
      where: { ownerId: otherOrganizationId },
      select: { id: true },
    });
    otherTenantEventId = otherEvent.id;
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({
      where: { ownerId: { in: [organizationId, otherOrganizationId] } },
    });
    await prisma.membership.deleteMany({
      where: { organizationId: { in: [organizationId, otherOrganizationId] } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [organizationId, otherOrganizationId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerId, auditorId, viewerId, outsiderId] } },
    });
    vi.mocked(auth.api.getSession).mockReset();
  });

  it("requires authentication and denies viewers or unrelated users", async () => {
    setSessionUser(null);
    const unauthenticated = await listOrganizationAuditEvents(
      new Request("http://localhost"),
      context(organizationId),
    );
    expect(unauthenticated.status).toBe(401);

    setSessionUser(viewerId);
    const viewer = await listOrganizationAuditEvents(
      new Request("http://localhost"),
      context(organizationId),
    );
    expect(viewer.status).toBe(403);

    setSessionUser(outsiderId);
    const outsider = await listOrganizationAuditEvents(
      new Request("http://localhost"),
      context(organizationId),
    );
    expect(outsider.status).toBe(403);
  });

  it("allows owners and auditors while redacting sensitive metadata and actor email", async () => {
    setSessionUser(auditorId);
    const auditorResponse = await listOrganizationAuditEvents(
      new Request("http://localhost"),
      context(organizationId),
    );
    expect(auditorResponse.status).toBe(200);
    expect(auditorResponse.headers.get("Cache-Control")).toBe("no-store");
    const auditorPayload = await auditorResponse.json();
    expect(auditorPayload.data).toHaveLength(2);
    const invitationEvent = auditorPayload.data.find(
      (event: { action: string }) => event.action === "invitation.created",
    );
    expect(invitationEvent.metadata).toEqual({
      role: "VIEWER",
      expiresAt: "2026-01-05T00:00:00.000Z",
    });
    expect(invitationEvent.actor).toEqual({
      id: auditorId,
      name: "Audit Reviewer",
    });
    expect(JSON.stringify(auditorPayload.data)).not.toContain("private-person@example.invalid");
    expect(JSON.stringify(auditorPayload.data)).not.toContain("never-return-this");

    setSessionUser(ownerId);
    const ownerResponse = await listOrganizationAuditEvents(
      new Request("http://localhost"),
      context(organizationId),
    );
    expect(ownerResponse.status).toBe(200);
  });

  it("rejects pagination cursors belonging to another tenant", async () => {
    setSessionUser(ownerId);
    const response = await listOrganizationAuditEvents(
      new Request(`http://localhost/api/v1/organizations/${organizationId}/audit-events?cursor=${otherTenantEventId}`),
      context(organizationId),
    );
    expect(response.status).toBe(422);
  });
});
