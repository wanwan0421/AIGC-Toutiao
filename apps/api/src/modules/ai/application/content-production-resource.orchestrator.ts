import { Injectable } from "@nestjs/common";
import type { DirectGenerateResult } from "@aicp/shared";
import { SkillRegistryService } from "../skills-runtime/skill-registry.service";

type ValidationResult = {
  ok: boolean;
  errors: string[];
  value: DirectGenerateResult;
};

const SKILL_KEY = "content-production-line" as const;

/** Server-owned policy for deciding which Skill resources each production stage may see. */
@Injectable()
export class ContentProductionResourceOrchestrator {
  constructor(private readonly registry: SkillRegistryService) {}

  loadSelectedSkill() {
    return this.registry.formatSkillInstructions(this.registry.loadSkillInstructions(SKILL_KEY));
  }

  loadRequirementAnalysis() {
    return this.registry.modelResourceText(SKILL_KEY, {
      prompts: ["01-requirement-analyzer.md"],
    });
  }

  loadArticleWriting() {
    return this.registry.modelResourceText(SKILL_KEY, {
      prompts: ["02-article-draft-writer.md"],
      references: ["toutiao-style-guide.md"],
    });
  }

  loadVisualPlanning() {
    return this.registry.modelResourceText(SKILL_KEY, {
      prompts: ["03-visual-plan.md"],
      assets: ["visual-style-presets.json"],
    });
  }

  loadOutputRepair() {
    return this.registry.modelResourceText(SKILL_KEY, {
      prompts: ["04-output-normalizer.md"],
      references: ["output-schema.md"],
    });
  }

  validateOutput(value: unknown) {
    return this.registry.executeScriptExport<ValidationResult>(
      SKILL_KEY,
      "validate_direct_generate_result.cjs",
      "validateDirectGenerateResult",
      value
    );
  }
}
