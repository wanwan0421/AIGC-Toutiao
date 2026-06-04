import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AiJobStatus, AiJobType, type DirectGenerateRequest, type GeneratedImageAsset } from "@aicp/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { CreativeProductionSkill } from "../ai/skills/creative-production.skill";
import { ContentWorkflowEngine } from "./content-workflow.engine";
import { WorkflowJobEventsService } from "./workflow-job-events.service";
import { toAiJobSnapshot, type AiJobRecord } from "./workflow-job.mapper";

type AiJobDelegate = {
  findUnique(args: unknown): Promise<AiJobRecord | null>;
  update(args: unknown): Promise<AiJobRecord>;
};

class JobCancelledError extends Error {
  constructor() {
    super("AI job was cancelled");
  }
}

@Injectable()
export class WorkflowJobRunner {
  private readonly logger = new Logger(WorkflowJobRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: WorkflowJobEventsService,
    private readonly workflow: ContentWorkflowEngine,
    private readonly productionSkill: CreativeProductionSkill
  ) {}

  async run(jobId: string) {
    const job = await this.aiJobs.findUnique({ where: { id: jobId } });
    if (!job || this.isTerminal(job.status)) return;

    try {
      await this.markRunning(jobId);
      await this.assertNotCancelled(jobId);

      const result = await this.runByType(jobId, job.type as `${AiJobType}`, this.asPayload(job.input), job.userId, job.contentId ?? undefined);
      await this.complete(jobId, result);
    } catch (error: unknown) {
      if (error instanceof JobCancelledError) {
        await this.cancel(jobId);
        return;
      }

      this.logger.error(`AI job ${jobId} failed: ${(error as Error).message}`, (error as Error).stack);
      await this.fail(jobId, (error as Error).message);
    }
  }

  private async runByType(
    jobId: string,
    type: `${AiJobType}`,
    payload: Record<string, unknown>,
    userId: string,
    contentId?: string
  ) {
    switch (type) {
      case AiJobType.CreativeDirectGenerate:
        return this.runCreativeDirectGenerate(jobId, payload as unknown as DirectGenerateRequest, userId);
      case AiJobType.CreativeImageGenerate:
        return this.runCreativeImageGenerate(jobId, payload, userId, contentId);
      case AiJobType.ContentSubmitReview:
        return this.runContentSubmitReview(jobId, userId, contentId);
      case AiJobType.ContentApprove:
        return this.runContentQualityScore(jobId, userId, contentId);
      case AiJobType.ModerationContentRun:
        return this.runModerationContentAudit(jobId, contentId);
      case AiJobType.ComplianceRewrite:
        return this.runComplianceRewrite(jobId, payload);
      default:
        throw new Error(`Unsupported AI job type: ${type}`);
    }
  }

  private async runCreativeDirectGenerate(jobId: string, input: DirectGenerateRequest, userId: string) {
    await this.progress(jobId, 10, "生成图文初稿", "AI 正在生成标题、正文和配图提示词");
    const draft = await this.productionSkill.generateDraft({ ...input, userId });
    await this.partial(jobId, "draft", draft);
    await this.assertNotCancelled(jobId);

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
      await this.progress(jobId, 45 + Math.round((index / total) * 45), `生成${task.position}`, `正在生成${task.position}图片`);
      try {
        const asset = await this.productionSkill.generateSingleImage({
          userId,
          contentId: input.contentId,
          position: task.position,
          prompt: task.prompt,
        });
        if (task.cover) {
          coverAsset = asset;
        } else {
          imageAssets.push(asset);
        }
        await this.partial(jobId, "imageAsset", { asset, cover: Boolean(task.cover) });
      } catch (error: unknown) {
        await this.warning(jobId, `${task.position}生成失败：${(error as Error).message}`);
      }
      await this.assertNotCancelled(jobId);
    }

    return {
      ...draft,
      coverAsset,
      imageAssets,
    };
  }

  private async runCreativeImageGenerate(
    jobId: string,
    payload: Record<string, unknown>,
    userId: string,
    contentId?: string
  ) {
    const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
    if (!prompt.trim()) {
      throw new Error("image prompt is required");
    }

    await this.progress(jobId, 30, "生成图片", "AI 正在生成图片素材");
    const asset = await this.productionSkill.generateSingleImage({
      userId,
      contentId: typeof payload.contentId === "string" ? payload.contentId : contentId,
      position: typeof payload.position === "string" ? payload.position : "正文配图",
      prompt,
    });
    await this.partial(jobId, "imageAsset", { asset });
    return { asset };
  }

  private async runContentSubmitReview(jobId: string, userId: string, contentId?: string) {
    if (!contentId) throw new Error("contentId is required");
    await this.progress(jobId, 20, "安全审核", "正在进行内容安全审核");
    const result = await this.workflow.submitReview(userId, contentId);
    await this.partial(jobId, "audit", { audit: result.audit, rewrite: result.rewrite });
    await this.partial(jobId, "content", result.content);
    return result;
  }

  private async runContentQualityScore(jobId: string, userId: string, contentId?: string) {
    if (!contentId) throw new Error("contentId is required");
    await this.progress(jobId, 20, "质量评估", "正在生成质量分，结果只作为分发推荐参考");
    const result = await this.workflow.scoreQuality(userId, contentId);
    await this.partial(jobId, "quality", result.quality);
    await this.partial(jobId, "content", result.content);
    return result;
  }

  private async runModerationContentAudit(jobId: string, contentId?: string) {
    if (!contentId) throw new Error("contentId is required");
    await this.progress(jobId, 20, "运行内容审核", "正在执行平台内容审核");
    const result = await this.workflow.runContentAudit(contentId);
    await this.partial(jobId, "audit", result);
    return result;
  }

  private async runComplianceRewrite(jobId: string, payload: Record<string, unknown>) {
    const title = typeof payload.title === "string" ? payload.title : "";
    const body = typeof payload.body === "string" ? payload.body : "";
    const reasons = Array.isArray(payload.reasons) ? payload.reasons.filter((item): item is string => typeof item === "string") : [];
    if (!title.trim() && !body.trim()) {
      throw new Error("title or body is required");
    }

    await this.progress(jobId, 30, "合规改写", "AI 正在生成合规替代内容");
    const rewrite = await this.workflow.rewriteText({ title, body, reasons });
    await this.partial(jobId, "rewrite", rewrite);
    return rewrite;
  }

  private async markRunning(jobId: string) {
    const updated = await this.aiJobs.update({
      where: { id: jobId },
      data: {
        status: AiJobStatus.Running,
        attempts: { increment: 1 },
        startedAt: new Date(),
      },
    });
    await this.events.publish(jobId, { type: "snapshot", data: { job: toAiJobSnapshot(updated) } });
  }

  private async progress(jobId: string, progress: number, currentStep: string, message: string) {
    const updated = await this.aiJobs.update({
      where: { id: jobId },
      data: { progress, currentStep },
    });
    await this.events.publish(jobId, {
      type: "progress",
      data: {
        job: toAiJobSnapshot(updated),
        progress,
        currentStep,
        message,
      },
    });
  }

  private async partial(jobId: string, kind: string, value: unknown) {
    await this.events.publish(jobId, {
      type: "partial",
      data: { kind, value },
    });
  }

  private async warning(jobId: string, message: string) {
    const updated = await this.aiJobs.update({
      where: { id: jobId },
      data: { warnings: { push: message } },
    });
    await this.events.publish(jobId, {
      type: "warning",
      data: { job: toAiJobSnapshot(updated), message },
    });
  }

  private async complete(jobId: string, result: unknown) {
    const updated = await this.aiJobs.update({
      where: { id: jobId },
      data: {
        status: AiJobStatus.Succeeded,
        progress: 100,
        currentStep: "已完成",
        result: this.toJson(result),
        completedAt: new Date(),
      },
    });
    const snapshot = toAiJobSnapshot(updated);
    await this.events.publish(jobId, { type: "done", data: { job: snapshot, result } });
  }

  private async fail(jobId: string, message: string) {
    const updated = await this.aiJobs.update({
      where: { id: jobId },
      data: {
        status: AiJobStatus.Failed,
        errorMessage: message,
        completedAt: new Date(),
      },
    });
    await this.events.publish(jobId, {
      type: "error",
      data: { job: toAiJobSnapshot(updated), message },
    });
  }

  private async cancel(jobId: string) {
    const updated = await this.aiJobs.update({
      where: { id: jobId },
      data: {
        status: AiJobStatus.Cancelled,
        errorMessage: "任务已取消",
        completedAt: new Date(),
      },
    });
    await this.events.publish(jobId, {
      type: "error",
      data: { job: toAiJobSnapshot(updated), message: "任务已取消" },
    });
  }

  private async assertNotCancelled(jobId: string) {
    const job = await this.aiJobs.findUnique({ where: { id: jobId }, select: { status: true } });
    if (job?.status === AiJobStatus.Cancelled) {
      throw new JobCancelledError();
    }
  }

  private isTerminal(status: string) {
    return status === AiJobStatus.Succeeded || status === AiJobStatus.Failed || status === AiJobStatus.Cancelled;
  }

  private get aiJobs(): AiJobDelegate {
    return (this.prisma as unknown as { aiJob: AiJobDelegate }).aiJob;
  }

  private asPayload(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  private toJson(value: unknown) {
    return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
  }
}
