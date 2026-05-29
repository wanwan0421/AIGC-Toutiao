import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import type { UserProfileSummary } from "@aicp/shared";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { AssetsService } from "./assets.service";

@UseGuards(AuthGuard)
@Controller("assets")
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Get()
  list(@CurrentUser() user: UserProfileSummary, @Query("contentId") contentId?: string) {
    return this.assetsService.list(user.id, contentId);
  }

  @Post()
  create(
    @CurrentUser() user: UserProfileSummary,
    @Body() body: { fileName: string; mimeType: string; url: string; contentId?: string }
  ) {
    return this.assetsService.create(user.id, body);
  }

  @Post(":id/link/:contentId")
  link(@CurrentUser() user: UserProfileSummary, @Param("id") id: string, @Param("contentId") contentId: string) {
    return this.assetsService.link(user.id, id, contentId);
  }
}
