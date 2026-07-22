import { Injectable, Logger } from "@nestjs/common";
import { AiJobStatus as DbAiJobStatus, Prisma } from "@prisma/client";
import { UnrecoverableError } from "bullmq";
import { randomUUID } from "node:crypto";
import { AiJobType, type DirectGenerateRequest, type PromptEvalRunRequest } from "@aicp/shared";
import { AppError, asAppError, jobCancelledError, throwIfAborted } from "../../common/app-error";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { ConversationArchiveService } from "../ai/conversation-archive.service";
import { CreativeProductionCapability } from "../ai/capabilities/creative-production.capability";
import { SkillExecutorService } from "../ai/skills-runtime/skill-executor.service";
import { PromptsService } from "../prompts/prompts.service";
import { ContentWorkflowEngine } from "./content-workflow.engine";
import { WorkflowJobEventsService } from "./workflow-job-events.service";
import { toAiJobSnapshot, type AiJobRecord } from "./workflow-job.mapper";

type RunOptions = {
  signal?: AbortSignal;
  attempt?: number;
  maxAttempts?: number;
};

const BROWSER_COMMIT_TYPES = new Set<string>([
  AiJobType.CreativeDirectGenerate,
  AiJobType.CreativeImageGenerate,
]);

@Injectable()
export class WorkflowJobRunner {
  private readonly logger = new Logger(WorkflowJobRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: WorkflowJobEventsService,
    private readonly workflow: ContentWorkflowEngine,
    private readonly productionCapability: CreativeProductionCapability,
    private readonly skillExecutor: SkillExecutorService,
    private readonly conversations: ConversationArchiveService,
    private readonly prompts: PromptsService
  ) {}

  async run(jobId: string, options: RunOptions = {}) {
    const runToken = randomUUID();
    const job = await this.markRunning(jobId, runToken);
    if (!job) return { executed: false as const };

    try {
      throwIfAborted(options.signal);
      const result = await this.runByType(
        jobId,
        runToken,
        job.type as `${AiJobType}`,
        this.asPayload(job.input),
        job.userId,
        job.contentId ?? undefined,
        options.signal
      );
      if (BROWSER_COMMIT_TYPES.has(job.type)) {
        await this.resultReady(jobId, runToken, result);
      } else {
        await this.complete(jobId, runToken, result);
      }
      return { executed: true as const };
    } catch (error) {
      const current = await this.prisma.aiJob.findUnique({ where: { id: jobId }, select: { status: true } });
      if (current?.status === DbAiJobStatus.cancelled) return { executed: true as const };

      let appError = asAppError(error, { code: "AI_JOB_EXECUTION_FAILED" });
      if (appError.code === "JOB_CANCELLED") {
        appError = new AppError({
          code: "WORKER_ABORTED",
          message: appError.message,
          statusCode: 503,
          retryable: true,
          cause: error,
        });
      }
      const attempt = options.attempt ?? 1;
      const maxAttempts = options.maxAttempts ?? 1;
      if (appError.retryable && attempt < maxAttempts) {
        await this.requeue(jobId, runToken, appError);
        throw appError;
      }

      this.logger.error(`AI job ${jobId} failed [${appError.code}, retryable=${appError.retryable}]: ${appError.message}`, error instanceof Error ? error.stack : undefined);
      const failed = await this.fail(jobId, runToken, appError);
      if (failed) {
        // Mark the BullMQ record as failed while preventing non-retryable
        // errors (and exhausted retryable errors) from consuming more attempts.
        throw new UnrecoverableError(`[${appError.code}] ${appError.message}`);
      }
      return { executed: true as const };
    }
  }

  private async runByType(
    jobId: string,
    runToken: string,
    type: `${AiJobType}`,
    payload: Record<string, unknown>,
    userId: string,
    contentId: string | undefined,
    signal?: AbortSignal
  ) {
    switch (type) {
      case AiJobType.CreativeDirectGenerate:
        return this.runCreativeDirectGenerate(jobId, runToken, payload as unknown as DirectGenerateRequest, userId, signal);
      case AiJobType.CreativeImageGenerate:
        return this.runCreativeImageGenerate(jobId, runToken, payload, userId, contentId, signal);
      case AiJobType.ContentSubmitReview:
        return this.runContentSubmitReview(jobId, runToken, userId, contentId, signal);
      case AiJobType.ContentApprove:
        return this.runContentQualityScore(jobId, runToken, userId, contentId, signal);
      case AiJobType.ModerationContentRun:
        return this.runModerationContentAudit(jobId, runToken, contentId, signal);
      case AiJobType.ComplianceRewrite:
        return this.runComplianceRewrite(jobId, runToken, payload, signal);
      case AiJobType.PromptEvalRun:
        return this.runPromptEvalRun(jobId, runToken, payload, signal);
      default:
        throw new AppError({ code: "UNSUPPORTED_AI_JOB_TYPE", message: `Unsupported AI job type: ${type}`, statusCode: 422, retryable: false });
    }
  }

  private runCreativeDirectGenerate(jobId: string, runToken: string, input: DirectGenerateRequest, userId: string, signal?: AbortSignal) {
    const payload = input as DirectGenerateRequest & { conversationId?: string; source?: "button" | "conversation" };
    return this.skillExecutor.runContentProductionLine(
      { ...payload, operationId: jobId },
      {
        userId,
        contentId: payload.contentId,
        conversationId: payload.conversationId,
        source: payload.source === "conversation" ? "conversation" : "button",
      },
      {
        progress: (progress, currentStep, message) => this.progress(jobId, runToken, progress, currentStep, message),
        partial: (kind, value) => this.partial(jobId, runToken, kind, value),
        warning: (message) => this.warning(jobId, runToken, message),
        assertNotCancelled: () => this.assertActive(jobId, runToken, signal),
        signal,
        loadCheckpoint: (stepKey) => this.loadCheckpoint(jobId, stepKey),
        saveCheckpoint: (stepKey, data) => this.saveCheckpoint(jobId, runToken, stepKey, data),
      }
    );
  }

  private async runCreativeImageGenerate(
    jobId: string,
    runToken: string,
    payload: Record<string, unknown>,
    userId: string,
    contentId?: string,
    signal?: AbortSignal
  ) {
    const cached = await this.loadCheckpoint(jobId, "single-image");
    if (cached) return cached;
    const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
    if (!prompt.trim()) throw new AppError({ code: "BAD_REQUEST", message: "image prompt is required", statusCode: 422, retryable: false });

    await this.progress(jobId, runToken, 30, "生成图片", "AI 正在生成图片素材");
    const asset = await this.productionCapability.generateSingleImage({
      userId,
      contentId: typeof payload.contentId === "string" ? payload.contentId : contentId,
      position: typeof payload.position === "string" ? payload.position : "正文配图",
      prompt,
      signal,
      generationKey: `${jobId}:single-image`,
    });
    await this.saveCheckpoint(jobId, runToken, "single-image", { asset });
    await this.partial(jobId, runToken, "imageAsset", { asset });
    return { asset };
  }

  private async runContentSubmitReview(jobId: string, runToken: string, userId: string, contentId?: string, signal?: AbortSignal) {
    const cached = await this.loadCheckpoint(jobId, "workflow-result");
    if (cached) return cached;
    if (!contentId) throw new AppError({ code: "BAD_REQUEST", message: "contentId is required", statusCode: 422, retryable: false });
    await this.progress(jobId, runToken, 20, "安全审核", "正在进行内容安全审核");
    const result = await this.workflow.submitReview(userId, contentId, { signal, aiJobId: jobId });
    await this.saveCheckpoint(jobId, runToken, "workflow-result", result);
    await this.partial(jobId, runToken, "audit", { audit: result.audit, rewrite: result.rewrite });
    await this.partial(jobId, runToken, "content", result.content);
    return result;
  }

  private async runContentQualityScore(jobId: string, runToken: string, userId: string, contentId?: string, signal?: AbortSignal) {
    const cached = await this.loadCheckpoint(jobId, "workflow-result");
    if (cached) return cached;
    if (!contentId) throw new AppError({ code: "BAD_REQUEST", message: "contentId is required", statusCode: 422, retryable: false });
    await this.progress(jobId, runToken, 20, "质量评估", "正在生成质量分，结果只作为分发推荐参考");
    const result = await this.workflow.scoreQuality(userId, contentId, { signal, aiJobId: jobId });
    await this.saveCheckpoint(jobId, runToken, "workflow-result", result);
    await this.partial(jobId, runToken, "quality", result.quality);
    await this.partial(jobId, runToken, "content", result.content);
    return result;
  }

  private async runModerationContentAudit(jobId: string, runToken: string, contentId?: string, signal?: AbortSignal) {
    const cached = await this.loadCheckpoint(jobId, "workflow-result");
    if (cached) return cached;
    if (!contentId) throw new AppError({ code: "BAD_REQUEST", message: "contentId is required", statusCode: 422, retryable: false });
    await this.progress(jobId, runToken, 20, "运行内容审核", "正在执行平台内容审核");
    const result = await this.workflow.runContentAudit(contentId, { signal, aiJobId: jobId });
    await this.saveCheckpoint(jobId, runToken, "workflow-result", result);
    await this.partial(jobId, runToken, "audit", result);
    return result;
  }

  private async runComplianceRewrite(jobId: string, runToken: string, payload: Record<string, unknown>, signal?: AbortSignal) {
    const cached = await this.loadCheckpoint(jobId, "workflow-result");
    if (cached) return cached;
    const title = typeof payload.title === "string" ? payload.title : "";
    const body = typeof payload.body === "string" ? payload.body : "";
    const reasons = Array.isArray(payload.reasons) ? payload.reasons.filter((item): item is string => typeof item === "string") : [];
    if (!title.trim() && !body.trim()) throw new AppError({ code: "BAD_REQUEST", message: "title or body is required", statusCode: 422, retryable: false });
    await this.progress(jobId, runToken, 30, "合规改写", "AI 正在生成合规替代内容");
    const rewrite = await this.workflow.rewriteText({ title, body, reasons }, { signal });
    await this.saveCheckpoint(jobId, runToken, "workflow-result", rewrite);
    await this.partial(jobId, runToken, "rewrite", rewrite);
    return rewrite;
  }

  private async runPromptEvalRun(jobId: string, runToken: string, payload: Record<string, unknown>, signal?: AbortSignal) {
    const cached = await this.loadCheckpoint(jobId, "workflow-result");
    if (cached) return cached;
    const promptKey = typeof payload.promptKey === "string" ? payload.promptKey : "";
    if (!promptKey.trim()) throw new AppError({ code: "BAD_REQUEST", message: "promptKey is required", statusCode: 422, retryable: false });
    const parsedCaseLimit = typeof payload.caseLimit === "number" ? payload.caseLimit : Number.parseInt(String(payload.caseLimit ?? ""), 10);
    const body: PromptEvalRunRequest = {
      mode: payload.mode === "llm_eval" ? "llm_eval" : "dry_run",
      versionId: typeof payload.versionId === "string" ? payload.versionId : undefined,
      includeDisabled: Boolean(payload.includeDisabled),
      caseLimit: Number.isFinite(parsedCaseLimit) && parsedCaseLimit > 0 ? Math.floor(parsedCaseLimit) : undefined,
      testCaseIds: Array.isArray(payload.testCaseIds) ? payload.testCaseIds.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : undefined,
    };
    await this.progress(jobId, runToken, 5, "Prompt Eval", "正在准备 Prompt 测试回放");
    const result = await this.prompts.runEvalJob(promptKey, body, jobId, {
      progress: (progress, currentStep, message) => this.progress(jobId, runToken, progress, currentStep, message),
      partial: (kind, value) => this.partial(jobId, runToken, kind, value),
      assertNotCancelled: () => this.assertActive(jobId, runToken, signal),
      signal,
    });
    await this.saveCheckpoint(jobId, runToken, "workflow-result", result);
    await this.partial(jobId, runToken, "promptEvalRun", result);
    return result;
  }

  private async markRunning(jobId: string, runToken: string) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.aiJob.updateMany({
        where: { id: jobId, status: { in: [DbAiJobStatus.queued, DbAiJobStatus.running] } },
        data: {
          status: DbAiJobStatus.running,
          runToken,
          attempts: { increment: 1 },
          startedAt: new Date(),
          completedAt: null,
          errorMessage: null,
          errorCode: null,
          errorRetryable: false,
        },
      });
      if (changed.count === 0) return null;
      const job = await tx.aiJob.findUniqueOrThrow({ where: { id: jobId } });
      const event = await this.events.createInTransaction(tx, jobId, { type: "snapshot", data: { job: toAiJobSnapshot(job) } });
      return { job, event };
    });
    if (!outcome) return null;
    await this.events.notify(jobId, outcome.event);
    return outcome.job;
  }

  private async progress(jobId: string, runToken: string, progress: number, currentStep: string, message: string) {
    return this.activeUpdate(jobId, runToken, { progress, currentStep }, "progress", (job) => ({
      job: toAiJobSnapshot(job), progress, currentStep, message,
    }));
  }

  private async partial(jobId: string, runToken: string, kind: string, value: unknown) {
    return this.activeEvent(jobId, runToken, "partial", { kind, value });
  }

  private async warning(jobId: string, runToken: string, message: string) {
    return this.activeUpdate(jobId, runToken, { warnings: { push: message } }, "warning", (job) => ({ job: toAiJobSnapshot(job), message }));
  }

  private async resultReady(jobId: string, runToken: string, result: unknown) {
    await this.terminalUpdate(jobId, runToken, {
      status: DbAiJobStatus.awaiting_commit,
      progress: 95,
      currentStep: "等待内容保存",
      result: this.toJson(result),
      resultReadyAt: new Date(),
      runToken: null,
    }, "result_ready", (job) => ({ job: toAiJobSnapshot(job), result }));
  }

  private async complete(jobId: string, runToken: string, result: unknown) {
    const updated = await this.terminalUpdate(jobId, runToken, {
      status: DbAiJobStatus.succeeded,
      progress: 100,
      currentStep: "已完成",
      result: this.toJson(result),
      completedAt: new Date(),
      runToken: null,
    }, "done", (job) => ({ job: toAiJobSnapshot(job), result }));
    if (updated) await this.archiveSkillCompletion(updated, result);
  }

  private async requeue(jobId: string, runToken: string, error: AppError) {
    await this.terminalUpdate(jobId, runToken, {
      status: DbAiJobStatus.queued,
      runToken: null,
      currentStep: "等待重试",
      errorMessage: error.message,
      errorCode: error.code,
      errorRetryable: true,
    }, "warning", (job) => ({ job: toAiJobSnapshot(job), message: error.message, code: error.code, retryable: true }));
  }

  private async fail(jobId: string, runToken: string, error: AppError) {
    return this.terminalUpdate(jobId, runToken, {
      status: DbAiJobStatus.failed,
      runToken: null,
      errorMessage: error.message,
      errorCode: error.code,
      errorRetryable: error.retryable,
      completedAt: new Date(),
    }, "error", (job) => ({ job: toAiJobSnapshot(job), message: error.message, code: error.code, retryable: error.retryable }));
  }

  private async activeUpdate(
    jobId: string,
    runToken: string,
    data: Prisma.AiJobUpdateManyMutationInput,
    type: "progress" | "warning",
    eventData: (job: AiJobRecord) => Record<string, unknown>
  ) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.aiJob.updateMany({ where: { id: jobId, status: DbAiJobStatus.running, runToken }, data });
      if (changed.count === 0) return null;
      const job = await tx.aiJob.findUniqueOrThrow({ where: { id: jobId } });
      const event = await this.events.createInTransaction(tx, jobId, { type, data: eventData(job) });
      return { event };
    });
    if (!outcome) throw jobCancelledError();
    await this.events.notify(jobId, outcome.event);
  }

  private async activeEvent(jobId: string, runToken: string, type: "partial", data: Record<string, unknown>) {
    const event = await this.prisma.$transaction(async (tx) => {
      // A conditional write takes the same row lock as cancel/terminal updates.
      // This prevents a partial event from being inserted after cancellation
      // won the race between a read-only status check and event creation.
      const active = await tx.aiJob.updateMany({
        where: { id: jobId, status: DbAiJobStatus.running, runToken },
        data: { updatedAt: new Date() },
      });
      if (active.count === 0) return null;
      return this.events.createInTransaction(tx, jobId, { type, data });
    });
    if (!event) throw jobCancelledError();
    await this.events.notify(jobId, event);
  }

  private async terminalUpdate(
    jobId: string,
    runToken: string,
    data: Prisma.AiJobUpdateManyMutationInput,
    type: "result_ready" | "done" | "error" | "warning",
    eventData: (job: AiJobRecord) => Record<string, unknown>
  ) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.aiJob.updateMany({ where: { id: jobId, status: DbAiJobStatus.running, runToken }, data });
      if (changed.count === 0) return null;
      const job = await tx.aiJob.findUniqueOrThrow({ where: { id: jobId } });
      const event = await this.events.createInTransaction(tx, jobId, { type, data: eventData(job) });
      return { job, event };
    });
    if (!outcome) return null;
    await this.events.notify(jobId, outcome.event);
    return outcome.job;
  }

  private async assertActive(jobId: string, runToken: string, signal?: AbortSignal) {
    throwIfAborted(signal);
    const active = await this.prisma.aiJob.count({ where: { id: jobId, status: DbAiJobStatus.running, runToken } });
    if (active === 0) throw jobCancelledError();
  }

  private async loadCheckpoint(jobId: string, stepKey: string) {
    const checkpoint = await this.prisma.aiJobCheckpoint.findUnique({ where: { jobId_stepKey: { jobId, stepKey } } });
    return checkpoint?.data;
  }

  private async saveCheckpoint(jobId: string, runToken: string, stepKey: string, data: unknown) {
    const saved = await this.prisma.$transaction(async (tx) => {
      const active = await tx.aiJob.updateMany({
        where: { id: jobId, status: DbAiJobStatus.running, runToken },
        data: { updatedAt: new Date() },
      });
      if (active.count === 0) return false;
      await tx.aiJobCheckpoint.upsert({
        where: { jobId_stepKey: { jobId, stepKey } },
        create: { jobId, stepKey, data: this.toJson(data) },
        update: {},
      });
      return true;
    });
    if (!saved) throw jobCancelledError();
    return true;
  }

  private async archiveSkillCompletion(job: AiJobRecord, result: unknown) {
    const input = this.asPayload(job.input);
    const conversationId = typeof input.conversationId === "string" ? input.conversationId : undefined;
    if (!conversationId) return;
    const content = job.type === AiJobType.ContentSubmitReview ? "内容审核已完成，结果已同步到发布流转面板。" : undefined;
    if (!content) return;
    await this.conversations.appendMessage({
      conversationId,
      role: "assistant",
      content,
      metadata: { jobId: job.id, jobType: job.type, contentId: job.contentId },
    }).catch((error) => this.logger.debug(`AI job ${job.id} completion archive skipped: ${error instanceof Error ? error.message : String(error)}`));
  }

  private asPayload(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  private toJson(value: unknown) {
    return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
  }
}
