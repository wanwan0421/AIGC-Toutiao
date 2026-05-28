-- Persist AI conversation history and mark generated assets.
CREATE TYPE "AiMessageRole" AS ENUM ('user', 'assistant');

ALTER TABLE "Asset"
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'uploaded',
ADD COLUMN "metadata" JSONB;

CREATE TABLE "AiConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contentId" TEXT,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "AiMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiConversation_userId_contentId_updatedAt_idx"
ON "AiConversation"("userId", "contentId", "updatedAt");

CREATE INDEX "AiMessage_conversationId_createdAt_idx"
ON "AiMessage"("conversationId", "createdAt");

ALTER TABLE "AiConversation"
ADD CONSTRAINT "AiConversation_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AiConversation"
ADD CONSTRAINT "AiConversation_contentId_fkey"
FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AiMessage"
ADD CONSTRAINT "AiMessage_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
