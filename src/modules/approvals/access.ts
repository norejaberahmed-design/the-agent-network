import { prisma } from "@/lib/prisma";

export async function canApproveAgentActions(agentId: string, userId: string) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      ownerType: true,
      userOwnerId: true,
      organizationOwnerId: true,
    },
  });
  if (!agent) return false;

  if (agent.ownerType === "USER") {
    return agent.userOwnerId === userId;
  }
  if (!agent.organizationOwnerId) return false;

  const membership = await prisma.membership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: agent.organizationOwnerId,
        userId,
      },
    },
    select: { role: true },
  });

  return membership?.role === "OWNER" || membership?.role === "ADMIN";
}
