ALTER TABLE "ImageModerationCache"
ADD COLUMN "policyVersion" TEXT NOT NULL DEFAULT '2026-10-21-v1';

ALTER TABLE "ImageModerationCache" ALTER COLUMN "policyVersion" DROP DEFAULT;
DROP INDEX "ImageModerationCache_sha256_key";
CREATE UNIQUE INDEX "ImageModerationCache_sha256_policyVersion_key" ON "ImageModerationCache"("sha256", "policyVersion");
