-- Align migration history with the existing Draft schema.
CREATE UNIQUE INDEX IF NOT EXISTS "Draft_contentId_key"
ON "Draft"("contentId");