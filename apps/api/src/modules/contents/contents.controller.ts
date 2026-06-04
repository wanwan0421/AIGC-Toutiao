import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AiJobType, ContentStatus, type UserProfileSummary } from "@aicp/shared";
import { AuthGuard } from "../auth/auth.guard";
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
};

@UseGuards(AuthGuard)
@Controller("contents")
export class ContentsController {
  constructor(
    private readonly contentsService: ContentsService,
    private readonly workflow: ContentWorkflowEngine,
    private readonly jobs: WorkflowJobService
  ) {}

  @Get()
  list(@CurrentUser() user: UserProfileSummary, @Query("status") status?: ContentStatus) {
    return this.contentsService.list(user.id, status);
  }

  @Post()
  create(
    @CurrentUser() user: UserProfileSummary,
    @Body() body: ContentWriteBody
  ) {
    return this.contentsService.create(user.id, body);
  }

  @Get(":id")
  detail(@CurrentUser() user: UserProfileSummary, @Param("id") id: string) {
    return this.contentsService.detail(user.id, id);
  }

  @Get(":id/versions")
  versions(@CurrentUser() user: UserProfileSummary, @Param("id") id: string) {
    return this.contentsService.versions(user.id, id);
  }

  @Post(":id/versions/:version/rollback")
  rollback(
    @CurrentUser() user: UserProfileSummary,
    @Param("id") id: string,
    @Param("version") version: string
  ) {
    return this.contentsService.rollback(user.id, id, Number(version));
  }

  @Patch(":id")
  update(
    @CurrentUser() user: UserProfileSummary,
    @Param("id") id: string,
    @Body() body: ContentWriteBody
  ) {
    return this.contentsService.update(user.id, id, body);
  }

  @Delete(":id")
  delete(@CurrentUser() user: UserProfileSummary, @Param("id") id: string) {
    return this.contentsService.delete(user.id, id);
  }

  @Post(":id/submit-review")
  submitReview(@CurrentUser() user: UserProfileSummary, @Param("id") id: string) {
    return this.workflow.submitReview(user.id, id);
  }

  @Post(":id/submit-review/jobs")
  submitReviewJob(@CurrentUser() user: UserProfileSummary, @Param("id") id: string) {
    return this.jobs.create({
      userId: user.id,
      type: AiJobType.ContentSubmitReview,
      payload: { contentId: id },
      contentId: id,
    });
  }

  @Post(":id/approve")
  approve(@CurrentUser() user: UserProfileSummary, @Param("id") id: string) {
    return this.workflow.scoreQuality(user.id, id);
  }

  @Post(":id/approve/jobs")
  approveJob(@CurrentUser() user: UserProfileSummary, @Param("id") id: string) {
    return this.qualityScoreJob(user, id);
  }

  @Post(":id/quality-score")
  qualityScore(@CurrentUser() user: UserProfileSummary, @Param("id") id: string) {
    return this.workflow.scoreQuality(user.id, id);
  }

  @Post(":id/quality-score/jobs")
  qualityScoreJob(@CurrentUser() user: UserProfileSummary, @Param("id") id: string) {
    return this.jobs.create({
      userId: user.id,
      // 兼容已有 AiJobType 枚举；业务语义已调整为“质量评估”。
      type: AiJobType.ContentApprove,
      payload: { contentId: id },
      contentId: id,
    });
  }

  @Post(":id/publish")
  publish(@CurrentUser() user: UserProfileSummary, @Param("id") id: string) {
    return this.workflow.publish(user.id, id);
  }

  @Post(":id/offline")
  offline(@CurrentUser() user: UserProfileSummary, @Param("id") id: string) {
    return this.workflow.offline(user.id, id);
  }
}
