ALTER TYPE "AgentRunStatus" ADD VALUE 'PLANNED' BEFORE 'WAITING_APPROVAL';

CREATE TYPE "AgentRunStepStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED', 'CANCELLED');

ALTER TABLE "AgentRun"
  ADD COLUMN "agentConfigurationVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "providerConsentAt" TIMESTAMP(3),
  ADD COLUMN "providerConsentVersion" VARCHAR(32) NOT NULL DEFAULT 'ai-processing-v1',
  ADD COLUMN "planSummary" VARCHAR(1000),
  ADD COLUMN "planSources" JSONB,
  ADD COLUMN "plannedAt" TIMESTAMP(3);

CREATE TABLE "AgentRunStep" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "stepId" VARCHAR(64) NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "action" VARCHAR(64) NOT NULL,
  "description" VARCHAR(500) NOT NULL,
  "input" JSONB NOT NULL,
  "status" "AgentRunStepStatus" NOT NULL DEFAULT 'PROPOSED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentRunStep_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentRunStep_runId_stepId_key" ON "AgentRunStep"("runId", "stepId");
CREATE UNIQUE INDEX "AgentRunStep_runId_ordinal_key" ON "AgentRunStep"("runId", "ordinal");
CREATE INDEX "AgentRunStep_runId_status_idx" ON "AgentRunStep"("runId", "status");

ALTER TABLE "AgentRunStep" ADD CONSTRAINT "AgentRunStep_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
