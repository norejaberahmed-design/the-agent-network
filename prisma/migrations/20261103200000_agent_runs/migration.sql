CREATE TYPE "AgentRunStatus" AS ENUM ('QUEUED', 'PLANNING', 'WAITING_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED', 'DEAD_LETTER');

ALTER TABLE "PermissionGrant" ADD COLUMN "reservedUses" INTEGER NOT NULL DEFAULT 0;

INSERT INTO "AgentCapability" ("id", "agentId", "key", "description", "languages", "createdAt")
SELECT
  'cap_' || md5("agentId" || '_READ_PUBLIC_PROFILE'),
  "agentId",
  'READ_PUBLIC_PROFILE',
  'Read explicitly public agent profiles within an owner-approved internal discovery grant.',
  ARRAY['ar', 'en']::TEXT[],
  CURRENT_TIMESTAMP
FROM "PermissionGrant"
WHERE 'DISCOVER_INTERNAL' = ANY("actionScope")
ON CONFLICT ("agentId", "key") DO NOTHING;

INSERT INTO "AgentCapability" ("id", "agentId", "key", "description", "languages", "createdAt")
SELECT
  'cap_' || md5("agentId" || '_SEARCH_PUBLIC_WEB'),
  "agentId",
  'SEARCH_PUBLIC_WEB',
  'Search public web sources within an owner-approved grant.',
  ARRAY['ar', 'en']::TEXT[],
  CURRENT_TIMESTAMP
FROM "PermissionGrant"
WHERE 'SEARCH_PUBLIC_WEB' = ANY("actionScope")
ON CONFLICT ("agentId", "key") DO NOTHING;


CREATE TABLE "AgentRun" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "requesterUserId" TEXT NOT NULL,
  "ownerType" "AgentOwnerType" NOT NULL,
  "ownerId" TEXT NOT NULL,
  "task" VARCHAR(4000) NOT NULL,
  "purpose" VARCHAR(300) NOT NULL,
  "target" VARCHAR(128) NOT NULL,
  "authorizedActions" TEXT[],
  "grantIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
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
