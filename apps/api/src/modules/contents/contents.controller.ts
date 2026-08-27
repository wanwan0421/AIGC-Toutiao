import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  AiJobType,
  ContentStatus,
  type ContentVisibility,
  type CreateContentCommentRequest,
  type UserProfileSummary,
} from "@aicp/shared";
import { AuthGuard } from "../auth/auth.guard";
import { AuthService } from "../auth/auth.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { ContentWorkflowEngine } from "../workflow/content-workflow.engine";
import { WorkflowJobService } from "../workflow/workflow-job.service";
import { ContentsService } from "./contents.service";

type ContentWriteBody = {
  title?: string;
  body?: string;
  bodyHtml?: string | null;
  bodyJson?: Record<string, unknown> | null;
  tags?: string[];
  assetIds?: string[];
  visibility?: ContentVisibility;
  scheduledAt?: string | null;
};

type PublishBody = {
  scheduledAt?: string | null;
  visibility?: ContentVisibility;
};

@Controller("contents")
export class ContentsController {
  constructor(
    private readonly contentsService: ContentsService,
    private readonly workflow: ContentWorkflowEngine,
    private readonly jobs: WorkflowJobService,
    private readonly authService: AuthService
  ) {}

  @UseGuards(AuthGuard)
  @Get()
  list(@CurrentUser() user: UserProfileSummary, @Query("status") status?: ContentStatus) {
    return this.contentsService.list(user.id, status);
  }

  @UseGuards(AuthGuard)
  @Post()
  create(
    @CurrentUser() user: UserProfileSummary,
    @Body() body: ContentWriteBody
  ) {
    return this.contentsService.create(user.id, body);
  }

  @Get(":id")
  async detail(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string
  ) {
    const user = await this.optionalUser(authorization);
    return this.contentsService.detail(user?.id, id);
  }

  @UseGuards(AuthGuard)
  @Get(":id/workflow-state")
  workflowState(@CurrentUser() user: UserProfileSummary, @Param("id") id: string) {
    return this.contentsService.workflowState(user.id, id);
  }

  @Get(":id/comments")
  async comments(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string
  ) {
    const user = await this.optionalUser(authorization);
    return this.contentsService.listComments(user?.id, id, limit, cursor);
  }

  @UseGuards(AuthGuard)
  @Post(":id/comments")
  createComment(
    @CurrentUser() user: UserProfileSummary,
    @Param("id") id: string,
    @Body() body: CreateContentCommentRequest
  ) {
    return this.contentsService.createComment(user.id, id, body);
  }

  @UseGuards(AuthGuard)
  @Get(":id/versions")
  versions(@CurrentUser() user: UserProfileSummary, @Param("id") id: string) {
    return this.contentsService.versions(user.id, id);
  }

  @UseGuards(AuthGuard)
  @Post(":id/versions/:version/rollback")
  rollback(
    @CurrentUser() user: UserProfileSummary,
    @Param("id") id: string,
    @Param("version") version: string
  ) {
    return this.contentsService.rollback(user.id, id, Number(version));
  }

  @UseGuards(AuthGuard)
  @Patch(":id")
  update(
    @CurrentUser() user: UserProfileSummary,
    @Param("id") id: string,
    @Body() body: ContentWriteBody
  ) {
    return this.contentsService.update(user.id, id, body);
  }

  @UseGuards(AuthGuard)
  @Patch(":id/visibility")
  updateVisibility(
    @CurrentUser() user: UserProfileSummary,
    @Param("id") id: string,
    @Body() body: { visibility: ContentVisibility }
  ) {
    return this.contentsService.updateVisibility(user.id, id, body.visibility);
  }

  @UseGuards(AuthGuard)
  @Delete(":id")
  delete(@CurrentUser() user: UserProfileSummary, @Param("id") id: string) {
    return this.contentsService.delete(user.id, id);
  }

  @UseGuards(AuthGuard)
  @Post(":id/submit-review")
  submitReview(
    @CurrentUser() user: UserProfileSummary,
    @Param("id") id: string,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.createContentAiJob(user.id, id, AiJobType.ContentSubmitReview, idempotencyKey);
  }

  @UseGuards(AuthGuard)
  @Post(":id/submit-review/jobs")
  submitReviewJob(
    @CurrentUser() user: UserProfileSummary,
    @Param("id") id: string,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.createContentAiJob(user.id, id, AiJobType.ContentSubmitReview, idempotencyKey);
  }

  @UseGuards(AuthGuard)
  @Post(":id/approve")
  approve(
    @CurrentUser() user: UserProfileSummary,
    @Param("id") id: string,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.createContentAiJob(user.id, id, AiJobType.ContentApprove, idempotencyKey);
  }

  @UseGuards(AuthGuard)
  @Post(":id/approve/jobs")
  approveJob(
    @CurrentUser() user: UserProfileSummary,
    @Param("id") id: string,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.createContentAiJob(user.id, id, AiJobType.ContentApprove, idempotencyKey);
  }

  @UseGuards(AuthGuard)
  @Post(":id/quality-score")
  qualityScore(
    @CurrentUser() user: UserProfileSummary,
    @Param("id") id: string,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.createContentAiJob(user.id, id, AiJobType.ContentApprove, idempotencyKey);
  }

  @UseGuards(AuthGuard)
  @Post(":id/quality-score/jobs")
  qualityScoreJob(
    @CurrentUser() user: UserProfileSummary,
    @Param("id") id: string,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.createContentAiJob(user.id, id, AiJobType.ContentApprove, idempotencyKey);
  }

  private createContentAiJob(userId: string, contentId: string, type: AiJobType, idempotencyKey?: string) {
    return this.jobs.create({
      userId,
      type,
      payload: { contentId },
      contentId,
      idempotencyKey: idempotencyKey?.slice(0, 128),
    });
  }

  @UseGuards(AuthGuard)
  @Post(":id/publish")
  publish(@CurrentUser() user: UserProfileSummary, @Param("id") id: string, @Body() body: PublishBody = {}) {
    return this.workflow.publish(user.id, id, body);
  }

  @UseGuards(AuthGuard)
  @Post(":id/reactions/like/toggle")
  toggleLike(@CurrentUser() user: UserProfileSummary, @Param("id") id: string) {
    return this.contentsService.toggleReaction(user.id, id, "like");
  }

  @UseGuards(AuthGuard)
  @Post(":id/reactions/collect/toggle")
  toggleCollect(@CurrentUser() user: UserProfileSummary, @Param("id") id: string) {
    return this.contentsService.toggleReaction(user.id, id, "collect");
  }

  @UseGuards(AuthGuard)
  @Post(":id/offline")
  offline(@CurrentUser() user: UserProfileSummary, @Param("id") id: string) {
    return this.workflow.offline(user.id, id);
  }

  private optionalUser(authorization?: string) {
    return this.authService.me(authorization).catch(() => null);
  }
}
