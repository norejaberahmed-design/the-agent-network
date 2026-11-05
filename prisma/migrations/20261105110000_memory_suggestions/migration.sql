ALTER TABLE "UserPersona"
  ADD COLUMN "memoryLearningEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "MemorySuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED');

CREATE TABLE "MemorySuggestion" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceRunId" TEXT NOT NULL,
  "content" VARCHAR(1000) NOT NULL,
  "evidenceExcerpt" VARCHAR(500) NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "dedupeKey" VARCHAR(64) NOT NULL,
  "status" "MemorySuggestionStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MemorySuggestion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MemorySuggestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MemorySuggestion_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MemorySuggestion_userId_dedupeKey_key" ON "MemorySuggestion"("userId", "dedupeKey");
CREATE INDEX "MemorySuggestion_userId_status_createdAt_idx" ON "MemorySuggestion"("userId", "status", "createdAt");
CREATE INDEX "MemorySuggestion_sourceRunId_idx" ON "MemorySuggestion"("sourceRunId");
