ALTER TABLE "AuditRecord" ADD COLUMN "contentHash" TEXT;

CREATE INDEX "AuditRecord_contentId_createdAt_idx" ON "AuditRecord"("contentId", "createdAt");
