-- Delete the legacy PromptTemplate table that has been fully migrated to PromptDefinition + PromptVersion system
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_prompts_fkey";
DROP TABLE IF EXISTS "PromptTemplate";

-- Remove the unused promptTemplateId column from AiCallLog
ALTER TABLE "AiCallLog" DROP COLUMN IF EXISTS "promptTemplateId";
