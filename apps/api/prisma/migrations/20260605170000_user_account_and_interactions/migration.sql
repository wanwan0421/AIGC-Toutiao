-- Account numbers are stable public-facing IDs. Existing users are backfilled
-- by creation order, while new users receive the next number in AuthService.
ALTER TABLE "User" ADD COLUMN "accountNo" INTEGER;

WITH numbered AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (ORDER BY "createdAt", "id") + 100000 AS "nextAccountNo"
  FROM "User"
)
UPDATE "User"
SET "accountNo" = numbered."nextAccountNo"
FROM numbered
WHERE "User"."id" = numbered."id";

ALTER TABLE "User" ALTER COLUMN "accountNo" SET NOT NULL;
CREATE UNIQUE INDEX "User_accountNo_key" ON "User"("accountNo");

CREATE TYPE "ContentReactionType" AS ENUM ('like', 'collect');

CREATE TABLE "UserFollow" (
  "id" TEXT NOT NULL,
  "followerId" TEXT NOT NULL,
  "followingId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserFollow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentReaction" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "contentId" TEXT NOT NULL,
  "type" "ContentReactionType" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContentReaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserFollow_followerId_followingId_key" ON "UserFollow"("followerId", "followingId");
CREATE INDEX "UserFollow_followerId_createdAt_idx" ON "UserFollow"("followerId", "createdAt");
CREATE INDEX "UserFollow_followingId_createdAt_idx" ON "UserFollow"("followingId", "createdAt");

CREATE UNIQUE INDEX "ContentReaction_userId_contentId_type_key" ON "ContentReaction"("userId", "contentId", "type");
CREATE INDEX "ContentReaction_contentId_type_idx" ON "ContentReaction"("contentId", "type");
CREATE INDEX "ContentReaction_userId_type_createdAt_idx" ON "ContentReaction"("userId", "type", "createdAt");

ALTER TABLE "UserFollow" ADD CONSTRAINT "UserFollow_followerId_fkey"
  FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserFollow" ADD CONSTRAINT "UserFollow_followingId_fkey"
  FOREIGN KEY ("followingId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentReaction" ADD CONSTRAINT "ContentReaction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentReaction" ADD CONSTRAINT "ContentReaction_contentId_fkey"
  FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;
