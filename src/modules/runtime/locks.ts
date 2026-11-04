import { Prisma } from "@prisma/client";

type Transaction = Prisma.TransactionClient;

/** Serializes queue, grant, lifecycle and worker transitions for one agent. */
export async function lockAgentRuntime(tx: Transaction, agentId: string): Promise<void> {
  await tx.$queryRaw<Array<{ pg_advisory_xact_lock: null }>>(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${agentId}, 0))
  `);
}
