import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ContentStatus, type UserProfileSummary } from "@aicp/shared";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { ContentsService } from "./contents.service";

@UseGuards(AuthGuard)
@Controller("contents")
export class ContentsController {
  constructor(private readonly contentsService: ContentsService) {}

  @Get()
  list(@CurrentUser() user: UserProfileSummary, @Query("status") status?: ContentStatus) {
    return this.contentsService.list(user.id, status);
  }

  @Post()
  create(
    @CurrentUser() user: UserProfileSummary,
    @Body() body: { title?: string; body?: string; tags?: string[]; assetIds?: string[] }
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

  @Patch(":id")
  update(
    @CurrentUser() user: UserProfileSummary,
    @Param("id") id: string,
    @Body() body: { title?: string; body?: string; tags?: string[]; assetIds?: string[] }
  ) {
    return this.contentsService.update(user.id, id, body);
  }

  @Post(":id/submit-review")
  submitReview(@CurrentUser() user: UserProfileSummary, @Param("id") id: string) {
    return this.contentsService.submitReview(user.id, id);
  }

  @Post(":id/approve")
  approve(@CurrentUser() user: UserProfileSummary, @Param("id") id: string) {
    return this.contentsService.approve(user.id, id);
  }

  @Post(":id/publish")
  publish(@CurrentUser() user: UserProfileSummary, @Param("id") id: string) {
    return this.contentsService.publish(user.id, id);
  }

  @Post(":id/offline")
  offline(@CurrentUser() user: UserProfileSummary, @Param("id") id: string) {
    return this.contentsService.offline(user.id, id);
  }
}
