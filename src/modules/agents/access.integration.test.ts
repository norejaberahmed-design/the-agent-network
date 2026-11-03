import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getAgentAccess } from "./access";

const enabled = process.env.RUN_DB_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;
const suffix = randomUUID();

const ownerA = `tenant-owner-a-${suffix}`;
const ownerB = `tenant-owner-b-${suffix}`;
const viewerA = `tenant-viewer-a-${suffix}`;
const outsider = `tenant-outsider-${suffix}`;
const orgA = `tenant-org-a-${suffix}`;
const orgB = `tenant-org-b-${suffix}`;
const agentA = `tenant-agent-a-${suffix}`;
const agentB = `tenant-agent-b-${suffix}`;

suite("agent tenant isolation (PostgreSQL integration)", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerA, name: "Tenant Owner A", email: `owner-a-${suffix}@example.invalid` },
        { id: ownerB, name: "Tenant Owner B", email: `owner-b-${suffix}@example.invalid` },
        { id: viewerA, name: "Tenant Viewer A", email: `viewer-a-${suffix}@example.invalid` },
        { id: outsider, name: "Tenant Outsider", email: `outsider-${suffix}@example.invalid` },
      ],
    });

    await prisma.organization.createMany({
      data: [
        { id: orgA, name: "Tenant Organization A", slug: `tenant-a-${suffix}` },
        { id: orgB, name: "Tenant Organization B", slug: `tenant-b-${suffix}` },
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
          name: "Organization A agent",
          purpose: "Tenant isolation integration fixture",
        },
        {
          id: agentB,
          ownerType: "ORGANIZATION",
          organizationOwnerId: orgB,
          name: "Organization B agent",
          purpose: "Tenant isolation integration fixture",
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.agent.deleteMany({ where: { id: { in: [agentA, agentB] } } });
    await prisma.membership.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerA, ownerB, viewerA, outsider] } } });
  });

  it("allows a member of organization A to access only organization A's agent", async () => {
    const ownTenant = await getAgentAccess(agentA, ownerA);
    const otherTenant = await getAgentAccess(agentB, ownerA);

    expect(ownTenant?.ownerType).toBe("ORGANIZATION");
    expect(ownTenant?.ownerId).toBe(orgA);
    expect(otherTenant).toBeNull();
  });

  it("does not infer membership from a different organization membership", async () => {
    const access = await getAgentAccess(agentA, ownerB);
    expect(access).toBeNull();
  });

  it("denies users who belong to neither tenant", async () => {
    await expect(getAgentAccess(agentA, outsider)).resolves.toBeNull();
    await expect(getAgentAccess(agentB, outsider)).resolves.toBeNull();
  });

  it("returns restricted capabilities to a VIEWER member", async () => {
    const access = await getAgentAccess(agentA, viewerA);

    expect(access?.canView).toBe(true);
    expect(access?.canViewPrivate).toBe(false);
    expect(access?.canViewGrants).toBe(false);
    expect(access?.canManageFieldPolicies).toBe(false);
    expect(access?.canManagePermissions).toBe(false);
  });
});
