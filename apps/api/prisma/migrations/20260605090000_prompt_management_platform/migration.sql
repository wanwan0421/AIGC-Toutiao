-- Prompt management platform: definitions, immutable versions, test cases, eval runs.

ALTER TABLE "AiCallLog" ADD COLUMN "promptKey" TEXT;
ALTER TABLE "AiCallLog" ADD COLUMN "promptVersionId" TEXT;
ALTER TABLE "AiCallLog" ADD COLUMN "promptTemplateId" TEXT;

CREATE TABLE "PromptDefinition" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scene" "PromptScene" NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "creatorId" TEXT,
    "activeVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PromptVersion" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "template" TEXT NOT NULL,
    "variables" JSONB,
    "model" TEXT,
    "modelOptions" JSONB,
    "outputSchema" JSONB,
    "changeNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PromptTestCase" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "expectedOutput" JSONB,
    "assertions" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptTestCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PromptEvalRun" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "versionId" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'dry_run',
    "status" TEXT NOT NULL DEFAULT 'succeeded',
    "total" INTEGER NOT NULL DEFAULT 0,
    "passed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptEvalRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PromptEvalResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "testCaseId" TEXT,
    "status" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "renderedPrompt" TEXT,
    "errorMessage" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptEvalResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PromptDefinition_key_key" ON "PromptDefinition"("key");
CREATE UNIQUE INDEX "PromptDefinition_activeVersionId_key" ON "PromptDefinition"("activeVersionId");
CREATE INDEX "PromptDefinition_scene_status_idx" ON "PromptDefinition"("scene", "status");
CREATE UNIQUE INDEX "PromptVersion_definitionId_version_key" ON "PromptVersion"("definitionId", "version");
CREATE INDEX "PromptVersion_definitionId_createdAt_idx" ON "PromptVersion"("definitionId", "createdAt");
CREATE INDEX "PromptTestCase_definitionId_enabled_idx" ON "PromptTestCase"("definitionId", "enabled");
CREATE INDEX "PromptEvalRun_definitionId_createdAt_idx" ON "PromptEvalRun"("definitionId", "createdAt");
CREATE INDEX "PromptEvalResult_runId_status_idx" ON "PromptEvalResult"("runId", "status");

ALTER TABLE "PromptDefinition" ADD CONSTRAINT "PromptDefinition_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PromptDefinition" ADD CONSTRAINT "PromptDefinition_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "PromptVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PromptVersion" ADD CONSTRAINT "PromptVersion_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "PromptDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromptVersion" ADD CONSTRAINT "PromptVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PromptTestCase" ADD CONSTRAINT "PromptTestCase_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "PromptDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromptEvalRun" ADD CONSTRAINT "PromptEvalRun_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "PromptDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromptEvalRun" ADD CONSTRAINT "PromptEvalRun_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "PromptVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PromptEvalResult" ADD CONSTRAINT "PromptEvalResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PromptEvalRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromptEvalResult" ADD CONSTRAINT "PromptEvalResult_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "PromptTestCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
