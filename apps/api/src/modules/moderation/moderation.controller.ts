import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AiJobType, type UserProfileSummary } from "@aicp/shared";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { WorkflowJobService } from "../workflow/workflow-job.service";
import { ModerationService } from "./moderation.service";

@Controller("moderation")
export class ModerationController {
  constructor(
    private readonly moderationService: ModerationService,
    private readonly jobs: WorkflowJobService
  ) {}

  @Get("contents/:contentId")
  getContentAudit(@Param("contentId") contentId: string) {
    return this.moderationService.getContentAudit(contentId);
  }

  @Post("contents/:contentId/run")
  runContentAudit(@Param("contentId") contentId: string) {
    return this.moderationService.runContentAudit(contentId);
  }

  @UseGuards(AuthGuard)
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
