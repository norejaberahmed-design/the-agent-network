CREATE TYPE "AgentRunStatus" AS ENUM ('QUEUED', 'PLANNING', 'WAITING_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED', 'DEAD_LETTER');

ALTER TABLE "PermissionGrant" ADD COLUMN "reservedUses" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "AgentRun" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "requesterUserId" TEXT NOT NULL,
  "ownerType" "AgentOwnerType" NOT NULL,
  "ownerId" TEXT NOT NULL,
  "task" VARCHAR(4000) NOT NULL,
  "purpose" VARCHAR(300) NOT NULL,
  "target" VARCHAR(128) NOT NULL,
  "authorizedActions" TEXT[] NOT NULL,
  "grantIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "requestDigest" VARCHAR(64) NOT NULL,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "status" "AgentRunStatus" NOT NULL DEFAULT 'QUEUED',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  "leaseExpiresAt" TIMESTAMP(3),
  "workerId" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "errorCode" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentRun_requesterUserId_idempotencyKey_key" ON "AgentRun"("requesterUserId", "idempotencyKey");
CREATE INDEX "AgentRun_status_availableAt_idx" ON "AgentRun"("status", "availableAt");
CREATE INDEX "AgentRun_agentId_createdAt_idx" ON "AgentRun"("agentId", "createdAt");
CREATE INDEX "AgentRun_ownerType_ownerId_createdAt_idx" ON "AgentRun"("ownerType", "ownerId", "createdAt");

ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_requesterUserId_fkey"
  FOREIGN KEY ("requesterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
