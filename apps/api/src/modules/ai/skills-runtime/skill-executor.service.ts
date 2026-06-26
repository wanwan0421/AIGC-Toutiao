import { Injectable } from "@nestjs/common";
import type { AuditResult, ComplianceRewriteResult, DirectGenerateRequest, DirectGenerateResult, GeneratedImageAsset } from "@aicp/shared";
import { CreativeProductionCapability } from "../capabilities/creative-production.capability";
import { SafetyReviewCapability } from "../capabilities/safety-review.capability";
import { SkillRegistryService } from "./skill-registry.service";
import type { ContentProductionLineInput, SkillExecutionContext, SkillProgressHooks } from "./skill-runtime.types";

type ImageTask = {
  position: string;
  prompt: string;
  slotId?: string;
  cover?: boolean;
};

type ImageTaskResult = {
  task: ImageTask;
  asset: GeneratedImageAsset;
};

@Injectable()
export class SkillExecutorService {
  constructor(
    private readonly productionCapability: CreativeProductionCapability,
    private readonly safetyReviewCapability: SafetyReviewCapability,
    private readonly registry: SkillRegistryService
  ) {}

  // 技能执行器提供的接口，供工作流引擎调用以执行具体技能逻辑
  async runContentProductionLine(
    input: ContentProductionLineInput,
    context: SkillExecutionContext,
    hooks: SkillProgressHooks = {}
  ): Promise<DirectGenerateResult> {
    const request = this.normalizeProductionInput(input, context);
    const trustedContext = this.productionTrustedContext();
    const operationId = input.operationId ?? context.conversationId ?? request.contentId ?? `production-${Date.now()}`;

    await hooks.progress?.(10, "分析需求与生成正文", "AI 正在分析需求、写作正文并规划配图");
    const draft = await this.productionCapability.generateDraft(request, { trustedContext });
    await hooks.partial?.("draft", draft);
    await hooks.assertNotCancelled?.();

    const imageTasks = this.buildImageTasks(draft);
    const imageResults = await this.generateImages(imageTasks, request, context, operationId, hooks);

    let coverAsset: GeneratedImageAsset | undefined;
    const imageAssets: GeneratedImageAsset[] = [];
    for (const result of imageResults) {
      if (result.task.cover) {
        coverAsset = result.asset;
      } else {
        imageAssets.push(result.asset);
      }
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
    return this.safetyReviewCapability.reviewWithRewrite(input, { trustedContext: this.safetyTrustedContext() });
  }

  private async generateImages(
    imageTasks: ImageTask[],
    request: DirectGenerateRequest,
    context: SkillExecutionContext,
    operationId: string,
    hooks: SkillProgressHooks
  ) {
    if (!imageTasks.length) return [];

    const results: Array<ImageTaskResult | undefined> = [];
    const total = imageTasks.length;
    const concurrency = Math.min(2, total);
    let nextIndex = 0;
    let completed = 0;

    const worker = async () => {
      while (nextIndex < total) {
        const index = nextIndex;
        nextIndex += 1;
        const task = imageTasks[index];
        await hooks.progress?.(
          50 + Math.round((completed / total) * 40),
          `生成${task.position}`,
          `正在生成图片 ${index + 1}/${total}：${task.position}`
        );

        try {
          const asset = await this.productionCapability.generateSingleImage({
            userId: context.userId,
            contentId: request.contentId,
            position: task.position,
            prompt: task.prompt,
            slotId: task.slotId,
          });
          results[index] = { task, asset };
          await hooks.partial?.("imageAsset", {
            asset,
            cover: Boolean(task.cover),
            role: task.cover ? "cover" : "inline",
            operationId,
            index,
            total,
            position: task.position,
            prompt: task.prompt,
            slotId: task.slotId,
          });
        } catch (error) {
          await hooks.warning?.(`${task.position}生成失败：${(error as Error).message}`);
        } finally {
          completed += 1;
          await hooks.assertNotCancelled?.();
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    await hooks.progress?.(95, "整理图文结果", "正在整理正文、封面和正文配图");
    return results.filter((item): item is ImageTaskResult => Boolean(item));
  }

  private buildImageTasks(draft: DirectGenerateResult): ImageTask[] {
    const imageTasks: ImageTask[] = [];
    if (draft.coverSuggestion) {
      imageTasks.push({ position: "封面", prompt: draft.coverSuggestion, cover: true });
    }
    for (const item of draft.imagePrompts.slice(0, this.inlineImageLimit(draft))) {
      imageTasks.push({
        position: item.position || "正文中",
        prompt: item.prompt,
        slotId: item.slotId,
      });
    }
    return imageTasks;
  }

  private inlineImageLimit(draft: DirectGenerateResult) {
    const paragraphs = draft.bodyMarkdown
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter((block) => block && !/^#{1,6}\s+/.test(block)).length;
    const sections = draft.outline.length || (draft.bodyMarkdown.match(/^#{1,6}\s+/gm) ?? []).length;

    if (paragraphs <= 4 && sections <= 2) return 1;
    if (paragraphs <= 8 && sections <= 3) return 2;
    if (paragraphs <= 14 && sections <= 5) return 3;
    return 4;
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

  private normalizeProductionInput(input: ContentProductionLineInput, context: SkillExecutionContext): DirectGenerateRequest {
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
