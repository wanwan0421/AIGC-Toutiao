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
    @Body() body: { type: AiJobType; payload?: Record<string, unknown>; contentId?: string }
  ) {
    return this.jobs.create({
      userId: user.id,
      type: body.type,
      payload: body.payload ?? {},
      contentId: body.contentId,
    });
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
        this.writeSse(response, { type: "error", data: { message: (error as Error).message } });
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
    @Body() body: AiJobResultCommitRequest
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
      this.writeSse(response, { type: "error", data: { message: (error as Error).message } });
    } finally {
      response.end();
    }
  }

  @Post("creative/direct-generate/jobs")
  startDirectGenerateJob(@CurrentUser() user: UserProfileSummary, @Body() body: DirectGenerateRequest) {
    return this.jobs.create({
      userId: user.id,
      type: AiJobType.CreativeDirectGenerate,
      payload: { ...body, userId: user.id },
      contentId: body.contentId,
    });
  }

  @Post("creative/image/jobs")
  startCreativeImageJob(
    @CurrentUser() user: UserProfileSummary,
    @Body() body: { contentId?: string; position?: string; prompt: string }
  ) {
    return this.jobs.create({
      userId: user.id,
      type: AiJobType.CreativeImageGenerate,
      payload: body,
      contentId: body.contentId,
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
    @Body() body: { contentId: string }
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
          message: `Skill 任务创建失败：${(error as Error).message}`,
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
