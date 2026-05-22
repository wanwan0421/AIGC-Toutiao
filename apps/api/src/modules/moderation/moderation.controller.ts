import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ModerationService } from "./moderation.service";

@Controller("moderation")
export class ModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  @Get("contents/:contentId")
  getContentAudit(@Param("contentId") contentId: string) {
    return this.moderationService.getContentAudit(contentId);
  }

  @Post("contents/:contentId/run")
  runContentAudit(@Param("contentId") contentId: string) {
    return this.moderationService.runContentAudit(contentId);
  }

  @Post("text")
  checkText(@Body() body: { title: string; body: string }) {
    return this.moderationService.checkText(body);
  }
}
