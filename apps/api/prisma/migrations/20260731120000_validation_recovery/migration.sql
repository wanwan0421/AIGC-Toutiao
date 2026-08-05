ALTER TABLE "AiJob"
ADD COLUMN "conversationId" TEXT,
ADD COLUMN "assistantMessageId" TEXT,
ADD COLUMN "idempotencyKey" TEXT;

ALTER TYPE "AiJobType" ADD VALUE IF NOT EXISTS 'creative_chat';

CREATE INDEX "AiJob_userId_conversationId_createdAt_idx"
ON "AiJob"("userId", "conversationId", "createdAt");

CREATE UNIQUE INDEX "AiJob_userId_idempotencyKey_key"
ON "AiJob"("userId", "idempotencyKey");
