ALTER TABLE "AiCallLog"
ADD COLUMN "provider" TEXT,
ADD COLUMN "apiStyle" TEXT,
ADD COLUMN "responseId" TEXT,
ADD COLUMN "inputTokens" INTEGER,
ADD COLUMN "cachedInputTokens" INTEGER,
ADD COLUMN "outputTokens" INTEGER,
ADD COLUMN "reasoningTokens" INTEGER,
ADD COLUMN "totalTokens" INTEGER,
ADD COLUMN "cacheType" TEXT,
ADD COLUMN "traceEnabled" BOOLEAN;

CREATE INDEX "AiCallLog_scene_createdAt_idx" ON "AiCallLog"("scene", "createdAt");
CREATE INDEX "AiCallLog_responseId_idx" ON "AiCallLog"("responseId");
