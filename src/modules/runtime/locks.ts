import { Prisma } from "@prisma/client";

type Transaction = Prisma.TransactionClient;

/** Serializes queue, grant, lifecycle and worker transitions for one agent. */
export async function lockAgentRuntime(tx: Transaction, agentId: string): Promise<void> {
  // pg_advisory_xact_lock returns PostgreSQL's pseudo-type "void". Returning it
  // through Prisma $queryRaw causes a P2010 deserialization failure. Keep the
  // volatile lock call inside a materialized CTE and return a supported scalar.
  await tx.$queryRaw<Array<{ locked: number }>>(Prisma.sql`
    WITH lock_result AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended(${agentId}, 0))
    )
    SELECT 1::int AS locked
    FROM lock_result
  `);
}
