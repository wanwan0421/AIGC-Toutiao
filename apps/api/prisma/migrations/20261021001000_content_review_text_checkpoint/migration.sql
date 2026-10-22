CREATE TABLE "ContentReviewTextCheckpoint" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "audit" JSONB NOT NULL,
    "rewrite" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentReviewTextCheckpoint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContentReviewTextCheckpoint_contentId_textHash_key" ON "ContentReviewTextCheckpoint"("contentId", "textHash");
CREATE INDEX "ContentReviewTextCheckpoint_updatedAt_idx" ON "ContentReviewTextCheckpoint"("updatedAt");
ALTER TABLE "ContentReviewTextCheckpoint" ADD CONSTRAINT "ContentReviewTextCheckpoint_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;
