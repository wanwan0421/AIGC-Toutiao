import { Injectable } from "@nestjs/common";
import type { AuditResult, ComplianceRewriteResult, DirectGenerateResult, GeneratedImageAsset } from "@aicp/shared";
import { CreativeProductionSkill } from "../skills/creative-production.skill";
import { SafetyReviewSkill } from "../skills/safety-review.skill";
import { SkillRegistryService } from "./skill-registry.service";
import type { ContentProductionLineInput, SkillExecutionContext, SkillProgressHooks } from "./skill-runtime.types";

@Injectable()
export class SkillExecutorService {
  constructor(
    private readonly productionSkill: CreativeProductionSkill,
    private readonly safetyReviewSkill: SafetyReviewSkill,
    private readonly registry: SkillRegistryService
  ) {}

  async runContentProductionLine(
    input: ContentProductionLineInput,
    context: SkillExecutionContext,
    hooks: SkillProgressHooks = {}
  ): Promise<DirectGenerateResult> {
    const request = this.normalizeProductionInput(input, context);
    const trustedContext = this.productionTrustedContext();

    await hooks.progress?.(10, "生成图文初稿", "AI 正在根据需求生成标题、正文和配图提示词");
    const draft = await this.productionSkill.generateDraft(request, { trustedContext });
    await hooks.partial?.("draft", draft);
    await hooks.assertNotCancelled?.();

    const imageTasks: Array<{ position: string; prompt: string; cover?: boolean }> = [];
    if (draft.coverSuggestion) {
      imageTasks.push({ position: "封面", prompt: draft.coverSuggestion, cover: true });
    }
    for (const item of draft.imagePrompts) {
      imageTasks.push({ position: item.position, prompt: item.prompt });
    }

    const imageAssets: GeneratedImageAsset[] = [];
    let coverAsset: GeneratedImageAsset | undefined;
    const total = Math.max(imageTasks.length, 1);

    for (let index = 0; index < imageTasks.length; index += 1) {
      const task = imageTasks[index];
      await hooks.progress?.(45 + Math.round((index / total) * 45), `生成${task.position}`, `正在生成${task.position}图片`);
      try {
        const asset = await this.productionSkill.generateSingleImage({
          userId: context.userId,
          contentId: request.contentId,
          position: task.position,
          prompt: task.prompt,
        });
        if (task.cover) {
          coverAsset = asset;
        } else {
          imageAssets.push(asset);
        }
        await hooks.partial?.("imageAsset", { asset, cover: Boolean(task.cover) });
      } catch (error) {
        await hooks.warning?.(`${task.position}生成失败：${(error as Error).message}`);
      }
      await hooks.assertNotCancelled?.();
    }

    return {
      ...draft,
      coverAsset,
      imageAssets,
    };
  }

  async runContentSafetyReviewer(input: { title: string; body: string }): Promise<{
    audit: AuditResult;
    rewrite: ComplianceRewriteResult | null;
  }> {
    return this.safetyReviewSkill.reviewWithRewrite(input, { trustedContext: this.safetyTrustedContext() });
  }

  private productionTrustedContext() {
    return this.registry.formatTrustedContext(
      this.registry.trustedContextFor("content-production-line", {
        prompts: [
          "01-requirement-analyzer.md",
          "02-article-draft-writer.md",
          "03-visual-plan.md",
          "04-output-normalizer.md",
        ],
        references: ["toutiao-style-guide.md", "output-schema.md", "examples.md"],
        scripts: ["validate_direct_generate_result.cjs"],
        assets: ["visual-style-presets.json"],
      })
    );
  }

  private safetyTrustedContext() {
    return this.registry.formatTrustedContext(
      this.registry.trustedContextFor("content-safety-reviewer", {
        prompts: ["01-semantic-risk-review.md", "02-compliance-rewrite.md"],
        references: ["risk-taxonomy.md", "output-schema.md", "rule-engine-contract.md"],
        scripts: ["merge_safety_review.cjs"],
      })
    );
  }

  private normalizeProductionInput(input: ContentProductionLineInput, context: SkillExecutionContext) {
    const theme = this.firstText(input.theme, input.message, input.currentTitle, this.summarize(input.currentBody), "未命名图文主题");
    const materialNotes = this.mergeNotes([
      input.materialNotes,
      input.source === "conversation" ? input.historyText : undefined,
      input.source === "conversation" ? input.currentBody : undefined,
    ]);

    return {
      userId: context.userId,
      contentId: input.contentId ?? context.contentId ?? undefined,
      theme,
      audience: input.audience,
      style: input.style,
      viewpoint: input.viewpoint,
      materialNotes,
      assets: input.assets,
    };
  }

  private firstText(...values: Array<string | undefined | null>) {
    return values.map((value) => value?.trim()).find((value): value is string => Boolean(value)) ?? "";
  }

  private summarize(value?: string | null) {
    const compact = value?.replace(/\s+/g, " ").trim() ?? "";
    return compact.slice(0, 80);
  }

  private mergeNotes(values: Array<string | undefined | null>) {
    const notes = values.map((value) => value?.trim()).filter((value): value is string => Boolean(value));
    return notes.length ? notes.join("\n\n") : undefined;
  }
}
