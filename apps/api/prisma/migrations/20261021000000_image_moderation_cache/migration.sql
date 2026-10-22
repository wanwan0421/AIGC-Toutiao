CREATE TABLE "ImageModerationCache" (
    "id" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "auditStatus" "AssetAuditStatus" NOT NULL,
    "auditReason" TEXT,
    "riskLevel" TEXT NOT NULL,
    "riskTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImageModerationCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImageModerationCache_sha256_key" ON "ImageModerationCache"("sha256");
CREATE INDEX "ImageModerationCache_auditStatus_updatedAt_idx" ON "ImageModerationCache"("auditStatus", "updatedAt");
