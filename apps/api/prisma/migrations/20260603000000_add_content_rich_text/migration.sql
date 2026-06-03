ALTER TABLE "Content"
  ADD COLUMN "bodyHtml" TEXT,
  ADD COLUMN "bodyJson" JSONB;

ALTER TABLE "ContentVersion"
  ADD COLUMN "bodyHtml" TEXT,
  ADD COLUMN "bodyJson" JSONB;
