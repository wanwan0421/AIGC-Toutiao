ALTER TABLE "AiCallLog"
ADD COLUMN "contentId" TEXT;

DROP INDEX IF EXISTS "AiCallLog_cacheType_idx";

ALTER TABLE "AiCallLog"
DROP COLUMN IF EXISTS "cacheType";

CREATE INDEX "AiCallLog_contentId_createdAt_idx"
ON "AiCallLog"("contentId", "createdAt");
