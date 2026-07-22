-- CreateTable
CREATE TABLE "AiJobEvent" (
  "id" BIGSERIAL NOT NULL,
  "jobId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AiJobEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiJobEvent_jobId_id_idx" ON "AiJobEvent"("jobId", "id");

-- AddForeignKey
ALTER TABLE "AiJobEvent"
ADD CONSTRAINT "AiJobEvent_jobId_fkey"
FOREIGN KEY ("jobId") REFERENCES "AiJob"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
