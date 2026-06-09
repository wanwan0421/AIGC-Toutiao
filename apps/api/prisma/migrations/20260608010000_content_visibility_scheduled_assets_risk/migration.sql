ALTER TYPE "ContentStatus" ADD VALUE IF NOT EXISTS 'scheduled';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ContentVisibility') THEN
    CREATE TYPE "ContentVisibility" AS ENUM ('public', 'followers', 'private');
  END IF;
END $$;

ALTER TABLE "Content"
  ADD COLUMN IF NOT EXISTS "visibility" "ContentVisibility" NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS "scheduledAt" TIMESTAMP(3);

ALTER TABLE "Asset"
  ADD COLUMN IF NOT EXISTS "riskLevel" TEXT,
  ADD COLUMN IF NOT EXISTS "riskTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
