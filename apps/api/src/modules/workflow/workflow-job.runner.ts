import { Injectable, Logger } from "@nestjs/common";
import { AiJobStatus as DbAiJobStatus, Prisma } from "@prisma/client";
import { UnrecoverableError } from "bullmq";
import { randomUUID } from "node:crypto";
import {
  AiJobType,
  type CreativeChatRequest,
  type DirectGenerateRequest,
  type PromptEvalRunRequest,
  type SelectionRewriteRequest,
  type TitleGenerateRequest,
} from "@aicp/shared";
import { AppError, asAppError, jobCancelledError, throwIfAborted } from "../../common/app-error";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { ConversationArchiveService } from "../ai/conversation-archive.service";
import { ConversationCompactionService } from "../ai/conversation-compaction.service";
import { ConversationSessionService } from "../ai/conversation-session.service";
import { MemoryService } from "../ai/memory.service";
import { GenerateContentUseCase } from "../ai/application/generate-content.use-case";
import { ImageGenerationService } from "../ai/image-generation.service";
import { PromptsService } from "../prompts/prompts.service";
import { ContentWorkflowEngine } from "./content-workflow.engine";
import { WorkflowJobEventsService } from "./workflow-job-events.service";
import { toAiJobSnapshot, type AiJobRecord } from "./workflow-job.mapper";
import { AiJobHandlerRegistry } from "./ai-job-handler.registry";
import { WorkflowJobService } from "./workflow-job.service";

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
    private readonly imageGeneration: ImageGenerationService,
    private readonly generateContent: GenerateContentUseCase,
    private readonly conversations: ConversationArchiveService,
    private readonly prompts: PromptsService,
    private readonly jobs: WorkflowJobService,
    private readonly handlers: AiJobHandlerRegistry,
    private readonly conversationCompaction?: ConversationCompactionService,
    private readonly conversationSessions?: ConversationSessionService,
    private readonly memory?: MemoryService
  ) {
    this.registerHandlers();
  }

  async run(jobId: string, options: RunOptions = {}) {
    const runToken = randomUUID();
    const job = await this.markRunning(jobId, runToken);
    if (!job) return { executed: false as const };

    try {
      throwIfAborted(options.signal);
      const result = await this.handlers.execute({
        jobId,
        runToken,
        type: job.type as `${AiJobType}`,
        payload: this.asPayload(job.input),
        userId: job.userId,
        contentId: job.contentId ?? undefined,
        conversationId: job.conversationId ?? undefined,
        signal: options.signal,
      });
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

  private registerHandlers() {
    this.handlers.register(AiJobType.CreativeChat, ({ jobId, runToken, payload, userId, signal }) =>
      this.runCreativeChat(jobId, runToken, payload, userId, signal));
    if (this.conversationCompaction && this.memory) {
      this.handlers.register(AiJobType.ConversationCompaction, ({ jobId, runToken, payload, userId, signal }) =>
        this.runConversationCompaction(jobId, runToken, payload, userId, signal));
    }
    this.handlers.register(AiJobType.CreativeTitleGenerate, ({ jobId, runToken, payload, contentId, conversationId, signal }) =>
      this.runCreativeTitleGenerate(jobId, runToken, payload as unknown as TitleGenerateRequest, contentId, conversationId, signal));
    this.handlers.register(AiJobType.CreativeSelectionRewrite, ({ jobId, runToken, payload, contentId, conversationId, signal }) =>
      this.runCreativeSelectionRewrite(jobId, runToken, payload as unknown as SelectionRewriteRequest, contentId, conversationId, signal));
    this.handlers.register(AiJobType.CreativeDirectGenerate, ({ jobId, runToken, payload, userId, signal }) =>
      this.runCreativeDirectGenerate(jobId, runToken, payload as unknown as DirectGenerateRequest, userId, signal));
    this.handlers.register(AiJobType.CreativeImageGenerate, ({ jobId, runToken, payload, userId, contentId, signal }) =>
      this.runCreativeImageGenerate(jobId, runToken, payload, userId, contentId, signal));
    this.handlers.register(AiJobType.ContentSubmitReview, ({ jobId, runToken, userId, contentId, signal }) =>
      this.runContentSubmitReview(jobId, runToken, userId, contentId, signal));
    this.handlers.register(AiJobType.ContentApprove, ({ jobId, runToken, userId, contentId, signal }) =>
      this.runContentQualityScore(jobId, runToken, userId, contentId, signal));
    this.handlers.register(AiJobType.ModerationContentRun, ({ jobId, runToken, userId, contentId, signal }) =>
      this.runModerationContentAudit(jobId, runToken, userId, contentId, signal));
    this.handlers.register(AiJobType.ModerationTextRun, ({ jobId, runToken, payload, signal }) =>
      this.runModerationTextAudit(jobId, runToken, payload, signal));
    this.handlers.register(AiJobType.ComplianceRewrite, ({ jobId, runToken, payload, signal }) =>
      this.runComplianceRewrite(jobId, runToken, payload, signal));
    this.handlers.register(AiJobType.PromptEvalRun, ({ jobId, runToken, payload, signal }) =>
      this.runPromptEvalRun(jobId, runToken, payload, signal));
  }

  private async runCreativeTitleGenerate(
    jobId: string,
    runToken: string,
    payload: TitleGenerateRequest,
    contentId?: string,
    conversationId?: string,
    signal?: AbortSignal
  ) {
    const cached = await this.loadCheckpoint(jobId, "workflow-result");
    if (cached) return cached;
    await this.progress(jobId, runToken, 20, "标题生成", "AI 正在生成标题候选");
    await this.assertActive(jobId, runToken, signal);
    const result = await this.workflow.generateTitles(payload, { signal, aiJobId: jobId, contentId, conversationId });
    await this.saveCheckpoint(jobId, runToken, "workflow-result", result);
    await this.partial(jobId, runToken, "titles", result);
    return result;
  }

  private async runCreativeSelectionRewrite(
    jobId: string,
    runToken: string,
    payload: SelectionRewriteRequest,
    contentId?: string,
    conversationId?: string,
    signal?: AbortSignal
  ) {
    const cached = await this.loadCheckpoint(jobId, "workflow-result");
    if (cached) return cached;
    await this.progress(jobId, runToken, 20, "局部改写", "AI 正在改写选中文本");
    await this.assertActive(jobId, runToken, signal);
    const result = await this.workflow.rewriteSelection(payload, { signal, aiJobId: jobId, contentId, conversationId });
    await this.saveCheckpoint(jobId, runToken, "workflow-result", result);
    await this.partial(jobId, runToken, "selectionRewrite", result);
    return result;
  }

  // 运行聊天任务
  private async runCreativeChat(jobId: string, runToken: string, payload: Record<string, unknown>, userId: string, signal?: AbortSignal) {
    const request = { ...payload, userId } as unknown as CreativeChatRequest;
    await this.progress(jobId, runToken, 10, "AI 对话", "AI 正在回复");
    let text = "";
    let conversationId = typeof payload.conversationId === "string" ? payload.conversationId : undefined;
    let messageId = typeof payload.assistantMessageId === "string" ? payload.assistantMessageId : undefined;
    for await (const event of this.workflow.streamCreativeChat(request, {
      signal,
      aiJobId: jobId,
      assistantMessageId: messageId,
    })) {
      await this.assertActive(jobId, runToken, signal);
      if (event.type === "delta") text += String((event.data as { text?: string }).text ?? "");
      if (event.type === "meta" || event.type === "done") {
        const data = event.data as { conversationId?: string; messageId?: string };
        conversationId = data.conversationId ?? conversationId;
        messageId = data.messageId ?? messageId;
      }
      if (event.type === "skill") {
        const data = event.data as Record<string, unknown>;
        const requestData = data.jobRequest as { type?: AiJobType; payload?: Record<string, unknown>; contentId?: string } | undefined;
        if (requestData?.type) {
          const nested = await this.createNestedJob(jobId, userId, conversationId, messageId, requestData);
          const { jobRequest: _private, ...publicData } = data;
          await this.partial(jobId, runToken, "creativeChatEvent", { type: "skill", data: publicData });
          await this.partial(jobId, runToken, "creativeChatEvent", { type: "skill", data: { type: "job_started", skillKey: publicData.skillKey, message: "Skill 任务已开始", job: nested } });
          continue;
        }
      }
      await this.partial(jobId, runToken, "creativeChatEvent", event);
    }
    if (conversationId && this.conversationCompaction && await this.conversationCompaction.shouldCompact(conversationId, userId)) {
      await this.jobs.create({
        userId,
        type: AiJobType.ConversationCompaction,
        payload: { conversationId },
        conversationId,
        idempotencyKey: `conversation-compaction:${conversationId}:${Math.floor(Date.now() / 60_000)}`,
      }).catch((error) => this.logger.debug(`Conversation compaction enqueue skipped: ${error instanceof Error ? error.message : String(error)}`));
    }
    return { conversationId, messageId, content: text };
  }

  private async runConversationCompaction(
    jobId: string,
    runToken: string,
    payload: Record<string, unknown>,
    userId: string,
    signal?: AbortSignal
  ) {
    const cached = await this.loadCheckpoint(jobId, "workflow-result");
    if (cached) return cached;
    const conversationId = typeof payload.conversationId === "string" ? payload.conversationId : "";
    if (!conversationId) {
      throw new AppError({ code: "BAD_REQUEST", message: "conversationId is required", statusCode: 422, retryable: false });
    }
    await this.progress(jobId, runToken, 20, "压缩对话上下文", "正在整理长期创作上下文");
    if (!this.conversationCompaction || !this.memory) {
      throw new AppError({ code: "INTERNAL_ERROR", message: "Conversation compaction is not configured", retryable: false });
    }
    const release = await this.memory.acquireConversationLock(conversationId, signal);
    try {
      const summary = await this.conversationCompaction.compact({ conversationId, userId, aiJobId: jobId, signal });
      const result = summary ? { conversationId, throughMessageId: summary.throughMessageId, coveredMessageCount: summary.coveredMessageCount } : { conversationId };
      await this.saveCheckpoint(jobId, runToken, "workflow-result", result);
      return result;
    } finally {
      await release();
    }
  }

  // 创建嵌套 Skill 任务
  private createNestedJob(parentJobId: string, userId: string, conversationId: string | undefined, assistantMessageId: string | undefined, request: { type?: AiJobType; payload?: Record<string, unknown>; contentId?: string }) {
    if (!request.type) throw new AppError({ code: "INVALID_TOOL_REQUEST", message: "Skill 任务类型无效", statusCode: 422, retryable: false });
    return this.jobs.create({
      userId,
      type: request.type,
      payload: request.payload ?? {},
      contentId: request.contentId,
      conversationId,
      assistantMessageId,
      idempotencyKey: `nested:${parentJobId}:${request.type}`,
    });
  }

  // 运行一键生成任务
  private runCreativeDirectGenerate(jobId: string, runToken: string, input: DirectGenerateRequest, userId: string, signal?: AbortSignal) {
    const payload = input as DirectGenerateRequest & { conversationId?: string; source?: "button" | "conversation" };
    return this.generateContent.execute(
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

  // 运行图片生成任务
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
    const asset = await this.imageGeneration.generateSingleImage({
      userId,
      contentId: typeof payload.contentId === "string" ? payload.contentId : contentId,
      position: typeof payload.position === "string" ? payload.position : "正文配图",
      prompt,
      signal,
      generationKey: `${jobId}:single-image`,
      aiJobId: jobId,
      conversationId: typeof payload.conversationId === "string" ? payload.conversationId : undefined,
    });
    await this.saveCheckpoint(jobId, runToken, "single-image", { asset });
    await this.partial(jobId, runToken, "imageAsset", { asset });
    return { asset };
  }

  // 运行内容提交审核任务
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

  // 运行内容质量评分任务
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

  private async runModerationContentAudit(jobId: string, runToken: string, userId: string, contentId?: string, signal?: AbortSignal) {
    const cached = await this.loadCheckpoint(jobId, "workflow-result");
    if (cached) return cached;
    if (!contentId) throw new AppError({ code: "BAD_REQUEST", message: "contentId is required", statusCode: 422, retryable: false });
    await this.progress(jobId, runToken, 20, "运行内容审核", "正在执行平台内容审核");
    const result = await this.workflow.runContentAudit(userId, contentId, { signal, aiJobId: jobId });
    await this.saveCheckpoint(jobId, runToken, "workflow-result", result);
    await this.partial(jobId, runToken, "audit", result);
    return result;
  }

  private async runModerationTextAudit(
    jobId: string,
    runToken: string,
    payload: Record<string, unknown>,
    signal?: AbortSignal
  ) {
    const cached = await this.loadCheckpoint(jobId, "workflow-result");
    if (cached) return cached;
    const title = typeof payload.title === "string" ? payload.title : "";
    const body = typeof payload.body === "string" ? payload.body : "";
    await this.progress(jobId, runToken, 20, "文本安全审核", "AI 正在审核文本内容");
    await this.assertActive(jobId, runToken, signal);
    const result = await this.workflow.checkText({ title, body }, { signal, aiJobId: jobId });
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
    const rewrite = await this.workflow.rewriteText({ title, body, reasons }, { signal, aiJobId: jobId });
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
    const publicMessage = this.publicErrorMessage(error);
    await this.terminalUpdate(jobId, runToken, {
      status: DbAiJobStatus.queued,
      runToken: null,
      currentStep: "等待重试",
      errorMessage: publicMessage,
      errorCode: error.code,
      errorRetryable: true,
    }, "warning", (job) => ({ job: toAiJobSnapshot(job), message: publicMessage, code: error.code, retryable: true }));
  }

  private async fail(jobId: string, runToken: string, error: AppError) {
    const publicMessage = this.publicErrorMessage(error);
    const failed = await this.terminalUpdate(jobId, runToken, {
      status: DbAiJobStatus.failed,
      runToken: null,
      errorMessage: publicMessage,
      errorCode: error.code,
      errorRetryable: error.retryable,
      completedAt: new Date(),
    }, "error", (job) => ({ job: toAiJobSnapshot(job), message: publicMessage, code: error.code, retryable: error.retryable }));
    if (failed) await this.archiveSkillFailure(failed, publicMessage, error.code);
    return failed;
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
      userId: job.userId,
      role: "assistant",
      content,
      metadata: { jobId: job.id, jobType: job.type, contentId: job.contentId },
    }).then(() => this.conversationSessions?.invalidate(conversationId, "skill_completion"))
      .catch((error) => this.logger.debug(`AI job ${job.id} completion archive skipped: ${error instanceof Error ? error.message : String(error)}`));
  }

  private async archiveSkillFailure(job: AiJobRecord, content: string, code: string) {
    const conversationId = job.conversationId ?? this.stringPayload(job.input, "conversationId");
    if (!conversationId) return;
    await this.conversations.appendMessage({
      conversationId, userId: job.userId, role: "assistant", content,
      metadata: { jobId: job.id, jobType: job.type, code, terminal: "failed" },
    }).then(() => this.conversationSessions?.invalidate(conversationId, "skill_failure")).catch(() => undefined);
  }

  private publicErrorMessage(error: AppError) {
    if (error.code === "CONTENT_NOT_REVIEWED" || error.code === "AUDIT_REQUIRED_BEFORE_PUBLISH" || error.code === "AUDIT_REQUIRED_BEFORE_QUALITY_SCORE") {
      return "请先完成并通过内容安全审核，再进行质量评估";
    }
    if (error.code === "CONTENT_REJECTED") return "内容安全审核未通过，请修改后重新审核";
    if (error.code === "CONTENT_CHANGED_AFTER_REVIEW") return "内容在审核后发生了变化，请重新进行内容安全审核";
    if (error.code === "CONTENT_STATUS_NOT_SCORABLE") return "当前内容状态不允许进行质量评估";
    if (error.code === "AI_CONFIGURATION_ERROR" || error.code === "UPSTREAM_AUTH_FAILED") {
      return "AI 服务配置异常，请联系管理员检查模型配置";
    }
    if (error.code === "UPSTREAM_TIMEOUT") return "AI 服务响应超时，系统将按策略自动重试";
    if (error.code === "JOB_CANCELLED") return "AI 任务已取消";
    if (error.code === "UPSTREAM_RATE_LIMITED") return "AI 服务请求过于频繁，请稍后重试";
    if (error.code === "UPSTREAM_BAD_REQUEST" && error.details?.service === "image_generation") {
      return "图片生成请求被模型服务拒绝，请检查文章或提示词中是否包含不支持或高风险内容";
    }
    if (error.code === "BAD_REQUEST" || error.statusCode === 422) return "任务输入不符合要求";
    return error.retryable ? "AI 服务暂时不可用，系统将自动重试" : "AI 任务执行失败，请稍后重试";
  }

  private stringPayload(value: unknown, key: string) {
    const payload = this.asPayload(value);
    return typeof payload[key] === "string" ? payload[key] as string : undefined;
  }

  private asPayload(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  private toJson(value: unknown) {
    return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
  }
}
