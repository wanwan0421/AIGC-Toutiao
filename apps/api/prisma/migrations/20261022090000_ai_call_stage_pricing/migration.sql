ALTER TABLE "AiCallLog"
ADD COLUMN "stage" TEXT,
ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "thinkingMode" TEXT,
ADD COLUMN "pricingSnapshot" JSONB;

CREATE INDEX "AiCallLog_aiJobId_stage_createdAt_idx"
ON "AiCallLog"("aiJobId", "stage", "createdAt");
