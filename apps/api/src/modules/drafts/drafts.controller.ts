import { Body, Controller, Get, Param, Put, UseGuards } from "@nestjs/common";
import type { UserProfileSummary } from "@aicp/shared";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { DraftsService } from "./drafts.service";

@UseGuards(AuthGuard)
@Controller("drafts")
export class DraftsController {
  constructor(private readonly draftsService: DraftsService) {}

  @Get(":contentId")
  getDraft(@CurrentUser() user: UserProfileSummary, @Param("contentId") contentId: string) {
    return this.draftsService.getDraft(user.id, contentId);
  }

  @Put(":contentId/autosave")
  autosave(
    @CurrentUser() user: UserProfileSummary,
    @Param("contentId") contentId: string,
    @Body() body: { title?: string; body?: string; payload?: Record<string, unknown>; clientHash?: string }
  ) {
    return this.draftsService.autosave(user.id, contentId, body);
  }
}
