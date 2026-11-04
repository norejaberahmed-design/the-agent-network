import { Prisma } from "@prisma/client";

type Transaction = Prisma.TransactionClient;

/** Serializes a single agent's queue, grant, lifecycle and worker transitions. */
export async function lockAgentRuntime(tx: Transaction, agentId: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${`agent-run-agent:${agentId}`}, 0))
  `);
}

export async function lockGrantRows(
  tx: Transaction,
  grantIds: string[],
): Promise<void> {
  const ids = [...new Set(grantIds)].sort();
  if (ids.length === 0) return;
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "PermissionGrant"
    WHERE "id" IN (${Prisma.join(ids)})
    ORDER BY "id"
    FOR UPDATE
  `);
}
