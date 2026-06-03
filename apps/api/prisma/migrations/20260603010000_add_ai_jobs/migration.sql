-- CreateEnum
CREATE TYPE "AiJobStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "AiJobType" AS ENUM (
  'creative_direct_generate',
  'creative_image_generate',
  'content_submit_review',
  'content_approve',
  'moderation_content_run',
  'compliance_rewrite'
);

-- CreateTable
CREATE TABLE "AiJob" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "contentId" TEXT,
  "type" "AiJobType" NOT NULL,
  "status" "AiJobStatus" NOT NULL DEFAULT 'queued',
  "progress" INTEGER NOT NULL DEFAULT 0,
  "currentStep" TEXT,
  "input" JSONB NOT NULL,
  "result" JSONB,
  "errorMessage" TEXT,
  "warnings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AiJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiJob_userId_createdAt_idx" ON "AiJob"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiJob_contentId_createdAt_idx" ON "AiJob"("contentId", "createdAt");

-- CreateIndex
CREATE INDEX "AiJob_status_updatedAt_idx" ON "AiJob"("status", "updatedAt");

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE SET NULL ON UPDATE CASCADE;
