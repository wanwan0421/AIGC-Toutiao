import { Body, Controller, Get, Headers, Param, Post, UseGuards } from "@nestjs/common";
import { AiJobType, type UserProfileSummary } from "@aicp/shared";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { WorkflowJobService } from "../workflow/workflow-job.service";
import { ModerationService } from "./moderation.service";

@UseGuards(AuthGuard)
@Controller("moderation")
export class ModerationController {
  constructor(
    private readonly moderationService: ModerationService,
    private readonly jobs: WorkflowJobService
  ) {}

  @Get("contents/:contentId")
  getContentAudit(@CurrentUser() user: UserProfileSummary, @Param("contentId") contentId: string) {
    return this.moderationService.getContentAudit(user.id, contentId);
  }

  @Post("contents/:contentId/run")
  runContentAudit(
    @CurrentUser() user: UserProfileSummary,
    @Param("contentId") contentId: string,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.createContentAuditJob(user.id, contentId, idempotencyKey);
  }

  @Post("contents/:contentId/run/jobs")
  runContentAuditJob(
    @CurrentUser() user: UserProfileSummary,
    @Param("contentId") contentId: string,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.createContentAuditJob(user.id, contentId, idempotencyKey);
  }

  @Post("text")
  checkText(
    @CurrentUser() user: UserProfileSummary,
    @Body() body: { title: string; body: string },
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.jobs.create({
      userId: user.id,
      type: AiJobType.ModerationTextRun,
      payload: body,
      idempotencyKey: idempotencyKey?.slice(0, 128),
    });
  }

  private createContentAuditJob(userId: string, contentId: string, idempotencyKey?: string) {
    return this.jobs.create({
      userId,
      type: AiJobType.ModerationContentRun,
      payload: { contentId },
      contentId,
      idempotencyKey: idempotencyKey?.slice(0, 128),
    });
  }
}
