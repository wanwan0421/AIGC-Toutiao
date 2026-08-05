import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import {
  AiJobType,
  type AiJobEvent,
  type AiJobResultCommitRequest,
  type CreativeChatRequest,
  type DirectGenerateRequest,
  type SelectionRewriteRequest,
  type TitleGenerateRequest,
  type UserProfileSummary
} from "@aicp/shared";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { ContentWorkflowEngine } from "../workflow/content-workflow.engine";
import { WorkflowJobService } from "../workflow/workflow-job.service";
import { WorkflowJobResultCommitService } from "../workflow/workflow-job-result-commit.service";
import { AttachConversationDto, CommitJobResultDto, CreativeImageJobDto, RecoverJobsQueryDto, StartAiJobDto } from "./ai.dto";

@UseGuards(AuthGuard)
@Controller("ai")
export class AiController {
  constructor(
    private readonly workflow: ContentWorkflowEngine,
    private readonly jobs: WorkflowJobService,
    private readonly jobResultCommit: WorkflowJobResultCommitService
  ) {}

  @Get("logs")
  logs() {
    return this.workflow.logs();
  }

  @Post("jobs")
  startJob(
    @CurrentUser() user: UserProfileSummary,
    @Body() body: StartAiJobDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.jobs.create({
      userId: user.id,
      type: body.type,
      payload: body.payload ?? {},
      contentId: body.contentId,
      conversationId: body.conversationId,
      assistantMessageId: body.assistantMessageId,
      idempotencyKey: idempotencyKey?.slice(0, 128),
    });
  }

  @Get("jobs")
  recoverJobs(@CurrentUser() user: UserProfileSummary, @Query() query: RecoverJobsQueryDto) {
    return this.jobs.recover(user.id, query);
  }

  @Get("jobs/:id/events")
  async streamJobEvents(
    @CurrentUser() user: UserProfileSummary,
    @Param("id") id: string,
    @Headers("last-event-id") lastEventIdHeader: string | undefined,
    @Query("after") after: string | undefined,
    @Res() response: Response
  ) {
    // Validate ownership before committing the response to SSE headers so that
    // authentication/not-found failures keep the shared structured HTTP shape.
    await this.jobs.get(user.id, id);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders?.();
    const streamAbort = new AbortController();
    const handleClose = () => streamAbort.abort();
    response.once("close", handleClose);

    try {
      for await (const event of this.jobs.stream(user.id, id, lastEventIdHeader ?? after, streamAbort.signal)) {
        this.writeSse(response, event);
      }
    } catch (error) {
      if (!streamAbort.signal.aborted) {
        this.writeSse(response, { type: "error", data: { message: "任务事件连接暂时中断，请重新连接", code: "EVENT_STREAM_INTERRUPTED", retryable: true } });
      }
    } finally {
      response.removeListener("close", handleClose);
      if (!response.writableEnded) response.end();
    }
  }

  @Get("jobs/:id")
  getJob(@CurrentUser() user: UserProfileSummary, @Param("id") id: string) {
    return this.jobs.get(user.id, id);
  }

  @Post("jobs/:id/cancel")
  cancelJob(@CurrentUser() user: UserProfileSummary, @Param("id") id: string) {
    return this.jobs.cancel(user.id, id);
  }

  @Post("jobs/:id/commit-result")
  commitJobResult(
    @CurrentUser() user: UserProfileSummary,
    @Param("id") id: string,
    @Body() body: CommitJobResultDto
  ) {
    return this.jobResultCommit.commit(user.id, id, body);
  }

  @Post("creative/chat/stream")
  async streamCreativeChat(
    @CurrentUser() user: UserProfileSummary,
    @Body() body: CreativeChatRequest,
    @Res() response: Response
  ) {
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders?.();

    try {
      for await (const event of this.workflow.streamCreativeChat({ ...body, userId: user.id })) {
        if (event.type === "skill") {
          await this.writeSkillEvent(response, user.id, event.data as Record<string, unknown>);
          continue;
        }
        this.writeSse(response, event);
      }
    } catch (error) {
      this.writeSse(response, { type: "error", data: { message: "AI 对话暂时失败，请稍后重试", code: "AI_STREAM_FAILED", retryable: true } });
    } finally {
      response.end();
    }
  }

  @Post("creative/direct-generate/jobs")
  startDirectGenerateJob(@CurrentUser() user: UserProfileSummary, @Body() body: DirectGenerateRequest) {
    const { userId: _ignoredUserId, ...payload } = body;
    return this.jobs.create({
      userId: user.id,
      type: AiJobType.CreativeDirectGenerate,
      payload,
      contentId: body.contentId,
    });
  }

  @Post("creative/image/jobs")
  startCreativeImageJob(
    @CurrentUser() user: UserProfileSummary,
    @Body() body: CreativeImageJobDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.jobs.create({
      userId: user.id,
      type: AiJobType.CreativeImageGenerate,
      payload: { ...body },
      contentId: body.contentId,
      conversationId: body.conversationId,
      assistantMessageId: body.assistantMessageId,
      idempotencyKey: idempotencyKey?.slice(0, 128),
    });
  }

  @Post("creative/titles")
  generateTitles(@Body() body: TitleGenerateRequest) {
    return this.workflow.generateTitles(body);
  }

  @Post("creative/selection/rewrite")
  rewriteSelection(@Body() body: SelectionRewriteRequest) {
    return this.workflow.rewriteSelection(body);
  }

  @Get("creative/image/config")
  creativeImageConfigStatus() {
    return this.workflow.creativeImageConfigStatus();
  }

  @Get("creative/conversations")
  creativeConversations(@CurrentUser() user: UserProfileSummary, @Query("contentId") contentId?: string) {
    if (!contentId) return [];
    return this.workflow.creativeConversations(contentId, user.id);
  }

  @Patch("creative/conversations/:id/attach")
  attachCreativeConversation(
    @CurrentUser() user: UserProfileSummary,
    @Param("id") id: string,
    @Body() body: AttachConversationDto
  ) {
    return this.workflow.attachCreativeConversation(id, { ...body, userId: user.id });
  }

  // 处理 Skill 事件，尝试从事件数据中提取 AiJob 创建请求
  // 如果存在有效的请求，则创建 AiJob 并发送相应的 SSE 事件通知前端
  // 如果请求无效，则直接发送原始事件数据
  private async writeSkillEvent(response: Response, userId: string, data: Record<string, unknown>) {
    const { jobRequest, ...publicData } = data;
    const request = jobRequest as
      | { type?: AiJobType; payload?: Record<string, unknown>; contentId?: string }
      | undefined;

    if (!request?.type) {
      this.writeSse(response, { type: "skill", data: publicData });
      return;
    }

    const skillKey = typeof publicData.skillKey === "string" ? publicData.skillKey : undefined;
    try {
      const job = await this.jobs.create({
        userId,
        type: request.type,
        payload: request.payload ?? {},
        contentId: request.contentId,
      });

      this.writeSse(response, { type: "skill", data: publicData });
      this.writeSse(response, {
        type: "skill",
        data: {
          type: "job_started",
          skillKey,
          message: "Skill 任务已开始",
          job,
        },
      });
    } catch (error) {
      this.writeSse(response, {
        type: "skill",
        data: {
          type: "skill_error",
          skillKey,
          message: "Skill 任务创建失败，请稍后重试",
        },
      });
    }
  }

  private writeSse(response: Response, event: AiJobEvent | { type: string; data: unknown }) {
    if (response.writableEnded || response.destroyed) return;
    if ("id" in event && event.id) response.write(`id: ${event.id}\n`);
    response.write(`event: ${event.type}\n`);
    response.write(`data: ${JSON.stringify(event.data)}\n\n`);
  }
}
