import { beforeEach, describe, expect, it, vi } from "vitest";

const { agentFindUnique, membershipFindUnique } = vi.hoisted(() => ({
  agentFindUnique: vi.fn(),
  membershipFindUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    agent: { findUnique: agentFindUnique },
    membership: { findUnique: membershipFindUnique },
  },
}));

import { getAgentAccess } from "./access";

const baseAgent = {
  id: "agent-a",
  ownerType: "ORGANIZATION",
  userOwnerId: null,
  organizationOwnerId: "org-a",
  name: "Agent A",
  purpose: "Private purpose",
  publicDescription: null,
  status: "DRAFT",
  discoverable: false,
  primaryLanguage: "ar",
  configurationVersion: 1,
};

describe("getAgentAccess tenant boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns no access when the agent does not exist", async () => {
    agentFindUnique.mockResolvedValue(null);

    await expect(getAgentAccess("missing-agent", "user-a")).resolves.toBeNull();
    expect(membershipFindUnique).not.toHaveBeenCalled();
  });

  it("does not grant a personal agent to a different user", async () => {
    agentFindUnique.mockResolvedValue({
      ...baseAgent,
      ownerType: "USER",
      userOwnerId: "user-owner",
      organizationOwnerId: null,
    });

    await expect(getAgentAccess("personal-agent", "attacker")).resolves.toBeNull();
    expect(membershipFindUnique).not.toHaveBeenCalled();
  });

  it("grants personal-agent access only to its exact owner", async () => {
    agentFindUnique.mockResolvedValue({
      ...baseAgent,
      ownerType: "USER",
      userOwnerId: "user-owner",
      organizationOwnerId: null,
    });

    const access = await getAgentAccess("personal-agent", "user-owner");

    expect(access).not.toBeNull();
    expect(access?.ownerType).toBe("USER");
    expect(access?.ownerId).toBe("user-owner");
    expect(access?.canManagePermissions).toBe(true);
  });

  it("denies access when an organization agent has no organization owner", async () => {
    agentFindUnique.mockResolvedValue({
      ...baseAgent,
      organizationOwnerId: null,
    });

    await expect(getAgentAccess("orphan-agent", "user-a")).resolves.toBeNull();
    expect(membershipFindUnique).not.toHaveBeenCalled();
  });

  it("denies a user who is not a member of the owning organization", async () => {
    agentFindUnique.mockResolvedValue(baseAgent);
    membershipFindUnique.mockResolvedValue(null);

    await expect(getAgentAccess("agent-a", "user-from-org-b")).resolves.toBeNull();
    expect(membershipFindUnique).toHaveBeenCalledWith({
      where: {
        organizationId_userId: {
          organizationId: "org-a",
          userId: "user-from-org-b",
        },
      },
      select: { role: true },
    });
  });

  it("applies the membership role from the agent's owning organization", async () => {
    agentFindUnique.mockResolvedValue(baseAgent);
    membershipFindUnique.mockResolvedValue({ role: "VIEWER" });

    const access = await getAgentAccess("agent-a", "viewer-a");

    expect(access?.ownerType).toBe("ORGANIZATION");
    expect(access?.ownerId).toBe("org-a");
    expect(access?.canView).toBe(true);
    expect(access?.canViewPrivate).toBe(false);
    expect(access?.canManagePermissions).toBe(false);
  });

  it("does not infer membership in organization A from membership in organization B", async () => {
    agentFindUnique.mockResolvedValue(baseAgent);
    membershipFindUnique.mockResolvedValue(null);

    const access = await getAgentAccess("agent-a", "member-of-org-b");

    expect(access).toBeNull();
    expect(membershipFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_userId: {
            organizationId: "org-a",
            userId: "member-of-org-b",
          },
        },
      }),
    );
  });
});
