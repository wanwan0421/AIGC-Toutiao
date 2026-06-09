import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import {
  AiJobType,
  type AiJobEvent,
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

@UseGuards(AuthGuard)
@Controller("ai")
export class AiController {
  constructor(
    private readonly workflow: ContentWorkflowEngine,
    private readonly jobs: WorkflowJobService
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
  async streamJobEvents(@CurrentUser() user: UserProfileSummary, @Param("id") id: string, @Res() response: Response) {
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders?.();

    try {
      for await (const event of this.jobs.stream(user.id, id)) {
        this.writeSse(response, event);
      }
    } catch (error) {
      this.writeSse(response, { type: "error", data: { message: (error as Error).message } });
    } finally {
      response.end();
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

  @Post("creative/direct-generate")
  directGenerate(@CurrentUser() user: UserProfileSummary, @Body() body: DirectGenerateRequest) {
    return this.workflow.directGenerate({ ...body, userId: user.id });
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
    response.write(`event: ${event.type}\n`);
    response.write(`data: ${JSON.stringify(event.data)}\n\n`);
  }
}
