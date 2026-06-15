-- Track which prompt test cases were created by users so platform seed cases stay protected.
ALTER TABLE "PromptTestCase" ADD COLUMN "createdById" TEXT;

CREATE INDEX "PromptTestCase_createdById_idx" ON "PromptTestCase"("createdById");

ALTER TABLE "PromptTestCase" ADD CONSTRAINT "PromptTestCase_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
