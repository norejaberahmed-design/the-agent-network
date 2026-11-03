import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export async function purgeExpiredAgentRuns(
  prisma: PrismaClient,
  now = new Date(),
  batchSize = 100,
): Promise<{ deleted: number; cancelled: number }> {
  const expiredRuns = await prisma.agentRun.findMany({
    where: { expiresAt: { lte: now } },
    orderBy: { expiresAt: "asc" },
    take: Math.min(Math.max(batchSize, 1), 500),
  });

  let deleted = 0;
  let cancelled = 0;

  for (const run of expiredRuns) {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.agentRun.findUnique({ where: { id: run.id } });
      if (!current || current.expiresAt > now) return { deleted: false, cancelled: false };

      let wasCancelled = false;
      if (current.status === "QUEUED" || current.status === "PLANNING") {
        const changed = await tx.agentRun.updateMany({
          where: {
            id: current.id,
            status: current.status,
            expiresAt: { lte: now },
          },
          data: {
            status: "CANCELLED",
            errorCode: "RETENTION_EXPIRED",
            cancelledAt: now,
            completedAt: now,
            workerId: null,
            claimedAt: null,
            leaseExpiresAt: null,
          },
        });
        if (changed.count !== 1) return { deleted: false, cancelled: false };

        wasCancelled = true;
        for (const grantId of current.grantIds) {
          const released = await tx.permissionGrant.updateMany({
            where: { id: grantId, agentId: current.agentId, reservedUses: { gt: 0 } },
            data: { reservedUses: { decrement: 1 } },
          });
          if (released.count !== 1) throw new Error("RETENTION_RESERVATION_RELEASE_FAILED");
        }
      }

      await tx.auditEvent.create({
        data: {
          agentId: current.agentId,
          ownerType: current.ownerType,
          ownerId: current.ownerId,
          action: "agent.run.expired",
          targetType: "AgentRun",
          targetId: current.id,
          outcome: "COMPLETED",
          policyVersion: String(current.agentConfigurationVersion),
          correlationId: randomUUID(),
          metadata: {
            previousStatus: current.status,
            retentionDays: 30,
            reservationsReleased: wasCancelled ? current.grantIds.length : 0,
          },
        },
      });

      const removed = await tx.agentRun.deleteMany({
        where: { id: current.id, expiresAt: { lte: now } },
      });
      return { deleted: removed.count === 1, cancelled: wasCancelled && removed.count === 1 };
    });

    if (result.deleted) deleted += 1;
    if (result.cancelled) cancelled += 1;
  }

  return { deleted, cancelled };
}
