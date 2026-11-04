CREATE TYPE "PersonalMemoryKind" AS ENUM ('CONFIRMED', 'INFERRED', 'TASK_CONTEXT');
CREATE TYPE "PersonalMemorySourceType" AS ENUM ('USER_STATEMENT', 'USER_CONFIRMED', 'OBSERVED_PATTERN', 'TASK');
CREATE TYPE "PersonalMemoryStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'DELETED');

CREATE TABLE "PersonalMemory" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" "PersonalMemoryKind" NOT NULL,
  "content" VARCHAR(2000) NOT NULL,
  "sourceType" "PersonalMemorySourceType" NOT NULL,
  "sourceReference" VARCHAR(300),
  "confidence" DOUBLE PRECISION,
  "classification" "DataClassification" NOT NULL DEFAULT 'CONTEXTUAL',
  "purpose" VARCHAR(240) NOT NULL,
  "taskContextRunId" VARCHAR(64),
  "status" "PersonalMemoryStatus" NOT NULL DEFAULT 'ACTIVE',
  "confirmedAt" TIMESTAMP(3),
  "lastObservedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PersonalMemory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PersonalMemory_userId_status_kind_updatedAt_idx"
  ON "PersonalMemory"("userId", "status", "kind", "updatedAt");
CREATE INDEX "PersonalMemory_userId_expiresAt_idx"
  ON "PersonalMemory"("userId", "expiresAt");
CREATE INDEX "PersonalMemory_taskContextRunId_idx"
  ON "PersonalMemory"("taskContextRunId");

ALTER TABLE "PersonalMemory"
  ADD CONSTRAINT "PersonalMemory_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
