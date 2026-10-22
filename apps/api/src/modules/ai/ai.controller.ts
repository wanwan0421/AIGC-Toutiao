import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Put, Query, Res, UseGuards } from "@nestjs/common";
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
import { AdminGuard } from "../auth/admin.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { ContentWorkflowEngine } from "../workflow/content-workflow.engine";
import { WorkflowJobService } from "../workflow/workflow-job.service";
import { WorkflowJobResultCommitService } from "../workflow/workflow-job-result-commit.service";
import { AttachConversationDto, CommitJobResultDto, CreativeImageJobDto, RecoverJobsQueryDto, StartAiJobDto } from "./ai.dto";
import { WritingSkillService } from "./writing-skill.service";

@UseGuards(AuthGuard)
@Controller("ai")
export class AiController {
  constructor(
    private readonly workflow: ContentWorkflowEngine,
    private readonly jobs: WorkflowJobService,
    private readonly jobResultCommit: WorkflowJobResultCommitService,
    private readonly writingSkill: WritingSkillService
  ) {}

  @Get("logs")
  @UseGuards(AdminGuard)
  logs() {
    return this.workflow.logs();
  }

  @Get("writing-skill")
  getWritingSkill(@CurrentUser() user: UserProfileSummary) { return this.writingSkill.get(user.id); }

  @Get("writing-skill/eligible-contents")
  eligibleWritingSkillContents(@CurrentUser() user: UserProfileSummary, @Query("page") page?: string, @Query("pageSize") pageSize?: string) {
    return this.writingSkill.eligible(user.id, Number(page ?? 1), Number(pageSize ?? 20));
  }

  @Post("writing-skill/build")
  @HttpCode(HttpStatus.ACCEPTED)
  buildWritingSkill(@CurrentUser() user: UserProfileSummary, @Body() body: { sourceContentIds?: string[] }, @Headers("idempotency-key") idempotencyKey?: string) {
    return this.jobs.createWritingSkillBuild(user.id, Array.isArray(body?.sourceContentIds) ? body.sourceContentIds : [], idempotencyKey?.slice(0, 128));
  }

  @Post("writing-skill/confirm")
  confirmWritingSkill(@CurrentUser() user: UserProfileSummary, @Body() body: { candidateVersionId: string; editedProfile: unknown; expectedSourceRevision: number; expectedEditRevision: number }) {
    return this.writingSkill.confirm(user.id, body.candidateVersionId, body.editedProfile, body.expectedSourceRevision, body.expectedEditRevision);
  }

  @Put("writing-skill/sources/:contentId")
  setWritingSkillSourceMode(@CurrentUser() user: UserProfileSummary, @Param("contentId") contentId: string, @Body() body: { mode: "manual" | "excluded" }) {
    if (body?.mode !== "manual" && body?.mode !== "excluded") throw new BadRequestException("mode must be manual or excluded");
    return this.writingSkill.setSourceMode(user.id, contentId, body.mode);
  }

  @Patch("writing-skill/profile")
  updateWritingSkillProfile(@CurrentUser() user: UserProfileSummary, @Body() body: { profile: unknown }) {
    return this.writingSkill.updateProfile(user.id, body?.profile);
  }

  @Post("writing-skill/profile/unlock")
  unlockWritingSkillProfilePaths(@CurrentUser() user: UserProfileSummary, @Body() body: { paths: string[] }) {
    return this.writingSkill.unlockProfilePaths(user.id, Array.isArray(body?.paths) ? body.paths : []);
  }

  @Post("writing-skill/versions/:id/restore")
  restoreWritingSkill(@CurrentUser() user: UserProfileSummary, @Param("id") id: string) { return this.writingSkill.restore(user.id, id); }

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
      idempotencyKey: (idempotencyKey?.trim() || body.idempotencyKey)?.slice(0, 128),
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

  @Post("creative/chat/jobs")
  startCreativeChatJob(
    @CurrentUser() user: UserProfileSummary,
    @Body() body: CreativeChatRequest,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const { userId: _ignoredUserId, ...payload } = body;
    return this.jobs.create({
      userId: user.id,
      type: AiJobType.CreativeChat,
      payload,
      contentId: body.contentId,
      conversationId: body.conversationId,
      idempotencyKey: idempotencyKey?.slice(0, 128),
    });
  }

  @Post("creative/direct-generate/jobs")
  startDirectGenerateJob(
    @CurrentUser() user: UserProfileSummary,
    @Body() body: DirectGenerateRequest,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const { userId: _ignoredUserId, ...payload } = body;
    return this.jobs.create({
      userId: user.id,
      type: AiJobType.CreativeDirectGenerate,
      payload,
      contentId: body.contentId,
      idempotencyKey: idempotencyKey?.slice(0, 128),
    });
  }

  @Post("creative/image/jobs")
  startCreativeImageJob(
    @CurrentUser() user: UserProfileSummary,
    @Body() body: CreativeImageJobDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const { idempotencyKey: bodyIdempotencyKey, ...payload } = body;
    return this.jobs.create({
      userId: user.id,
      type: AiJobType.CreativeImageGenerate,
      payload,
      contentId: body.contentId,
      conversationId: body.conversationId,
      assistantMessageId: body.assistantMessageId,
      idempotencyKey: (idempotencyKey?.trim() || bodyIdempotencyKey)?.slice(0, 128),
    });
  }

  @Post("creative/titles")
  generateTitles(
    @CurrentUser() user: UserProfileSummary,
    @Body() body: TitleGenerateRequest,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.jobs.create({
      userId: user.id,
      type: AiJobType.CreativeTitleGenerate,
      payload: { ...body },
      idempotencyKey: idempotencyKey?.slice(0, 128),
    });
  }

  @Post("creative/selection/rewrite")
  rewriteSelection(
    @CurrentUser() user: UserProfileSummary,
    @Body() body: SelectionRewriteRequest,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.jobs.create({
      userId: user.id,
      type: AiJobType.CreativeSelectionRewrite,
      payload: { ...body },
      idempotencyKey: idempotencyKey?.slice(0, 128),
    });
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

  private writeSse(response: Response, event: AiJobEvent | { type: string; data: unknown }) {
    if (response.writableEnded || response.destroyed) return;
    if ("id" in event && event.id) response.write(`id: ${event.id}\n`);
    response.write(`event: ${event.type}\n`);
    response.write(`data: ${JSON.stringify(event.data)}\n\n`);
  }
}
