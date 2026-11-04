import { Prisma } from "@prisma/client";

type Transaction = Prisma.TransactionClient;

/**
 * Acquires the agent row lock for the rest of the current transaction.
 * The dedicated counter avoids changing business configuration versions or
 * relying on PostgreSQL void-returning advisory lock functions.
 */
export async function lockAgentRuntime(tx: Transaction, agentId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    UPDATE "Agent"
    SET "runtimeLockVersion" = "runtimeLockVersion" + 1
    WHERE "id" = ${agentId}
    RETURNING "id"
  `);
  if (rows.length !== 1) throw new Error("AGENT_RUNTIME_LOCK_NOT_FOUND");
}

export async function lockGrantRows(
  tx: Transaction,
  grantIds: string[],
): Promise<void> {
  const ids = [...new Set(grantIds)].sort();
  if (ids.length === 0) return;
  await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "PermissionGrant"
    WHERE "id" IN (${Prisma.join(ids)})
    ORDER BY "id"
    FOR UPDATE
  `);
}

/** Serializes the per-user hourly queue quota check. */
export async function lockUserRuntime(tx: Transaction, userId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    UPDATE "User"
    SET "runtimeLockVersion" = "runtimeLockVersion" + 1
    WHERE "id" = ${userId}
    RETURNING "id"
  `);
  if (rows.length !== 1) throw new Error("USER_RUNTIME_LOCK_NOT_FOUND");
}
