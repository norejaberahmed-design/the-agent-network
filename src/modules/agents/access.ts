import { prisma } from "@/lib/prisma";

const MANAGER_ROLES = ["OWNER", "ADMIN", "AGENT_MANAGER"] as const;

export async function getAgentAccess(agentId: string, userId: string) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      ownerType: true,
      userOwnerId: true,
      organizationOwnerId: true,
      name: true,
      purpose: true,
      publicDescription: true,
      status: true,
      discoverable: true,
      primaryLanguage: true,
      configurationVersion: true,
    },
  });

  if (!agent) return null;

  if (agent.ownerType === "USER") {
    if (agent.userOwnerId !== userId) return null;
    return {
      agent,
      canView: true,
      canManage: true,
      ownerType: "USER" as const,
      ownerId: userId,
    };
  }

  if (!agent.organizationOwnerId) return null;
  const membership = await prisma.membership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: agent.organizationOwnerId,
        userId,
      },
    },
    select: { role: true },
  });

  if (!membership) return null;
  return {
    agent,
    canView: true,
    canManage: MANAGER_ROLES.includes(membership.role as (typeof MANAGER_ROLES)[number]),
    ownerType: "ORGANIZATION" as const,
    ownerId: agent.organizationOwnerId,
  };
}
