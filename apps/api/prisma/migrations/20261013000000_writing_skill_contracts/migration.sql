CREATE TYPE "WritingSkillSourceMode" AS ENUM ('manual', 'auto', 'excluded');
CREATE TYPE "AssetTextStatus" AS ENUM ('pending', 'extracted', 'failed');

CREATE TABLE "WritingSkill" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activeVersionId" TEXT,
    "candidateVersionId" TEXT,
    "sourceRevision" INTEGER NOT NULL DEFAULT 0,
    "appliedRevision" INTEGER NOT NULL DEFAULT 0,
    "editRevision" INTEGER NOT NULL DEFAULT 0,
    "autoLearnFromAt" TIMESTAMP(3),
    "pauseReason" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WritingSkill_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WritingSkill_revision_nonnegative" CHECK (
        "sourceRevision" >= 0 AND "appliedRevision" >= 0
        AND "appliedRevision" <= "sourceRevision" AND "editRevision" >= 0
    )
);

CREATE TABLE "WritingSkillVersion" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "profile" JSONB NOT NULL,
    "sourceManifest" JSONB NOT NULL,
    "sourceRevision" INTEGER NOT NULL,
    "editRevision" INTEGER NOT NULL,
    "origin" TEXT NOT NULL,
    "parentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WritingSkillVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WritingSkillVersion_revision_nonnegative" CHECK (
        "versionNo" > 0 AND "sourceRevision" >= 0 AND "editRevision" >= 0
    ),
    CONSTRAINT "WritingSkillVersion_json_shapes" CHECK (
        jsonb_typeof("profile") = 'object'
        AND jsonb_typeof("sourceManifest") = 'array'
    )
);

CREATE TABLE "WritingSkillSource" (
    "skillId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "mode" "WritingSkillSourceMode" NOT NULL,
    "contentHash" TEXT,
    "extractedProfile" JSONB,
    "extractedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WritingSkillSource_pkey" PRIMARY KEY ("skillId", "contentId")
);

CREATE TABLE "AssetExtractedText" (
    "assetId" TEXT NOT NULL,
    "fullText" TEXT,
    "charCount" INTEGER,
    "fileHash" TEXT,
    "extractorVersion" TEXT,
    "status" "AssetTextStatus" NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "fullTextAuditStatus" "AssetAuditStatus" NOT NULL DEFAULT 'pending',
    "auditedHash" TEXT,
    "extractedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AssetExtractedText_pkey" PRIMARY KEY ("assetId"),
    CONSTRAINT "AssetExtractedText_charCount_nonnegative" CHECK ("charCount" IS NULL OR "charCount" >= 0)
);

CREATE UNIQUE INDEX "WritingSkill_userId_key" ON "WritingSkill"("userId");
CREATE UNIQUE INDEX "WritingSkill_activeVersionId_key" ON "WritingSkill"("activeVersionId");
CREATE UNIQUE INDEX "WritingSkill_candidateVersionId_key" ON "WritingSkill"("candidateVersionId");
CREATE INDEX "WritingSkill_sourceRevision_appliedRevision_idx" ON "WritingSkill"("sourceRevision", "appliedRevision");
CREATE UNIQUE INDEX "WritingSkillVersion_skillId_versionNo_key" ON "WritingSkillVersion"("skillId", "versionNo");
CREATE INDEX "WritingSkillVersion_skillId_createdAt_idx" ON "WritingSkillVersion"("skillId", "createdAt");
CREATE INDEX "WritingSkillVersion_parentVersionId_idx" ON "WritingSkillVersion"("parentVersionId");
CREATE INDEX "WritingSkillSource_contentId_idx" ON "WritingSkillSource"("contentId");
CREATE INDEX "WritingSkillSource_skillId_mode_idx" ON "WritingSkillSource"("skillId", "mode");
CREATE INDEX "AssetExtractedText_status_fullTextAuditStatus_idx" ON "AssetExtractedText"("status", "fullTextAuditStatus");

ALTER TABLE "WritingSkill" ADD CONSTRAINT "WritingSkill_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WritingSkillVersion" ADD CONSTRAINT "WritingSkillVersion_skillId_fkey"
    FOREIGN KEY ("skillId") REFERENCES "WritingSkill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WritingSkillVersion" ADD CONSTRAINT "WritingSkillVersion_parentVersionId_fkey"
    FOREIGN KEY ("parentVersionId") REFERENCES "WritingSkillVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WritingSkill" ADD CONSTRAINT "WritingSkill_activeVersionId_fkey"
    FOREIGN KEY ("activeVersionId") REFERENCES "WritingSkillVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WritingSkill" ADD CONSTRAINT "WritingSkill_candidateVersionId_fkey"
    FOREIGN KEY ("candidateVersionId") REFERENCES "WritingSkillVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WritingSkillSource" ADD CONSTRAINT "WritingSkillSource_skillId_fkey"
    FOREIGN KEY ("skillId") REFERENCES "WritingSkill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WritingSkillSource" ADD CONSTRAINT "WritingSkillSource_contentId_fkey"
    FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssetExtractedText" ADD CONSTRAINT "AssetExtractedText_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A version pointer must never resolve to another author's skill. Plain foreign keys
-- prove that the version exists, but cannot express this ownership condition.
CREATE FUNCTION "writing_skill_check_version_ownership"() RETURNS trigger AS $$
BEGIN
    IF NEW."activeVersionId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "WritingSkillVersion" AS version
        WHERE version."id" = NEW."activeVersionId" AND version."skillId" = NEW."id"
    ) THEN
        RAISE EXCEPTION 'active writing skill version belongs to another skill'
            USING ERRCODE = '23514';
    END IF;
    IF NEW."candidateVersionId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "WritingSkillVersion" AS version
        WHERE version."id" = NEW."candidateVersionId" AND version."skillId" = NEW."id"
    ) THEN
        RAISE EXCEPTION 'candidate writing skill version belongs to another skill'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "WritingSkill_version_ownership"
    BEFORE INSERT OR UPDATE OF "activeVersionId", "candidateVersionId", "id" ON "WritingSkill"
    FOR EACH ROW EXECUTE FUNCTION "writing_skill_check_version_ownership"();

-- Profile and source manifest are immutable once a version has been created.
-- Parent removal may clear parentVersionId through its SET NULL foreign key.
CREATE FUNCTION "writing_skill_version_enforce_immutability"() RETURNS trigger AS $$
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id"
        OR NEW."skillId" IS DISTINCT FROM OLD."skillId"
        OR NEW."versionNo" IS DISTINCT FROM OLD."versionNo"
        OR NEW."profile" IS DISTINCT FROM OLD."profile"
        OR NEW."sourceManifest" IS DISTINCT FROM OLD."sourceManifest"
        OR NEW."sourceRevision" IS DISTINCT FROM OLD."sourceRevision"
        OR NEW."editRevision" IS DISTINCT FROM OLD."editRevision"
        OR NEW."origin" IS DISTINCT FROM OLD."origin"
        OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
        OR (NEW."parentVersionId" IS DISTINCT FROM OLD."parentVersionId"
            AND NEW."parentVersionId" IS NOT NULL) THEN
        RAISE EXCEPTION 'writing skill versions are immutable'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "WritingSkillVersion_immutable"
    BEFORE UPDATE ON "WritingSkillVersion"
    FOR EACH ROW EXECUTE FUNCTION "writing_skill_version_enforce_immutability"();

CREATE FUNCTION "writing_skill_version_check_parent_ownership"() RETURNS trigger AS $$
BEGIN
    IF NEW."parentVersionId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "WritingSkillVersion" AS parent
        WHERE parent."id" = NEW."parentVersionId" AND parent."skillId" = NEW."skillId"
    ) THEN
        RAISE EXCEPTION 'parent writing skill version belongs to another skill'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "WritingSkillVersion_parent_ownership"
    BEFORE INSERT OR UPDATE OF "parentVersionId" ON "WritingSkillVersion"
    FOR EACH ROW EXECUTE FUNCTION "writing_skill_version_check_parent_ownership"();

CREATE FUNCTION "writing_skill_source_check_author"() RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "WritingSkill" AS skill
        JOIN "Content" AS content ON content."authorId" = skill."userId"
        WHERE skill."id" = NEW."skillId" AND content."id" = NEW."contentId"
    ) THEN
        RAISE EXCEPTION 'writing skill source must belong to the skill author'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "WritingSkillSource_author_ownership"
    BEFORE INSERT OR UPDATE OF "skillId", "contentId" ON "WritingSkillSource"
    FOR EACH ROW EXECUTE FUNCTION "writing_skill_source_check_author"();
