-- Add the explicit browser-commit phase before terminal success.
ALTER TYPE "AiJobStatus" ADD VALUE IF NOT EXISTS 'awaiting_commit';

CREATE TYPE "AiJobDispatchStatus" AS ENUM ('pending', 'dispatching', 'dispatched', 'cancelled');

ALTER TABLE "Asset"
  ADD COLUMN "generationKey" TEXT;

ALTER TABLE "AuditRecord"
  ADD COLUMN "aiJobId" TEXT;

ALTER TABLE "QualityScore"
  ADD COLUMN "aiJobId" TEXT;

ALTER TABLE "AiJob"
  ADD COLUMN "errorCode" TEXT,
  ADD COLUMN "errorRetryable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "runToken" TEXT,
  ADD COLUMN "resultReadyAt" TIMESTAMP(3),
  ADD COLUMN "appliedAt" TIMESTAMP(3),
  ADD COLUMN "appliedEventId" BIGINT,
  ADD COLUMN "appliedPayloadHash" TEXT,
  ADD COLUMN "cancelRequestedAt" TIMESTAMP(3);

CREATE TABLE "AiJobDispatch" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "status" "AiJobDispatchStatus" NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiJobDispatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiJobCheckpoint" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "stepKey" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiJobCheckpoint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Asset_generationKey_key" ON "Asset"("generationKey");
CREATE UNIQUE INDEX "AuditRecord_aiJobId_key" ON "AuditRecord"("aiJobId");
CREATE UNIQUE INDEX "QualityScore_aiJobId_key" ON "QualityScore"("aiJobId");
CREATE INDEX "AiJob_status_completedAt_idx" ON "AiJob"("status", "completedAt");
CREATE INDEX "AiJobEvent_createdAt_id_idx" ON "AiJobEvent"("createdAt", "id");
CREATE UNIQUE INDEX "AiJobDispatch_jobId_key" ON "AiJobDispatch"("jobId");
CREATE INDEX "AiJobDispatch_status_nextAttemptAt_idx" ON "AiJobDispatch"("status", "nextAttemptAt");
CREATE INDEX "AiJobDispatch_lockedUntil_idx" ON "AiJobDispatch"("lockedUntil");
CREATE UNIQUE INDEX "AiJobCheckpoint_jobId_stepKey_key" ON "AiJobCheckpoint"("jobId", "stepKey");
CREATE INDEX "AiJobCheckpoint_jobId_createdAt_idx" ON "AiJobCheckpoint"("jobId", "createdAt");

-- Keep the latest result if historic data contains duplicate case executions.
DELETE FROM "PromptEvalResult" older
USING "PromptEvalResult" newer
WHERE older."runId" = newer."runId"
  AND older."testCaseId" IS NOT NULL
  AND older."testCaseId" = newer."testCaseId"
  AND (older."createdAt", older."id") < (newer."createdAt", newer."id");

CREATE UNIQUE INDEX "PromptEvalResult_runId_testCaseId_key"
  ON "PromptEvalResult"("runId", "testCaseId");

ALTER TABLE "AiJobDispatch"
  ADD CONSTRAINT "AiJobDispatch_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "AiJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiJobCheckpoint"
  ADD CONSTRAINT "AiJobCheckpoint_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "AiJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One-time handoff from the old in-process executor to the durable queue.
UPDATE "AiJob"
SET "status" = 'queued',
    "runToken" = NULL,
    "currentStep" = '等待队列恢复',
    "completedAt" = NULL
WHERE "status" IN ('queued', 'running');

INSERT INTO "AiJobDispatch" (
  "id", "jobId", "status", "attempts", "nextAttemptAt", "createdAt", "updatedAt"
)
SELECT
  'dispatch-' || "id",
  "id",
  'pending',
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "AiJob"
WHERE "status" = 'queued'
ON CONFLICT ("jobId") DO NOTHING;
