ALTER TABLE "QualityScore" ADD COLUMN "contentHash" TEXT;

CREATE UNIQUE INDEX "QualityScore_contentId_contentHash_key"
ON "QualityScore"("contentId", "contentHash");
