import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
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
  runContentAudit(@CurrentUser() user: UserProfileSummary, @Param("contentId") contentId: string) {
    return this.moderationService.runContentAudit(user.id, contentId);
  }

  @Post("contents/:contentId/run/jobs")
  runContentAuditJob(@CurrentUser() user: UserProfileSummary, @Param("contentId") contentId: string) {
    return this.jobs.create({
      userId: user.id,
      type: AiJobType.ModerationContentRun,
      payload: { contentId },
      contentId,
    });
  }

  @Post("text")
  checkText(@Body() body: { title: string; body: string }) {
    return this.moderationService.checkText(body);
  }
}
