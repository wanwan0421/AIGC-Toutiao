import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ContentStatus, type UserProfileSummary } from "@aicp/shared";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { ContentWorkflowEngine } from "../workflow/content-workflow.engine";
import { ContentsService } from "./contents.service";

@UseGuards(AuthGuard)
@Controller("contents")
export class ContentsController {
  constructor(
    private readonly contentsService: ContentsService,
    private readonly workflow: ContentWorkflowEngine
  ) {}

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
    @Body() body: { title?: string; body?: string; tags?: string[]; assetIds?: string[] }
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

  @Post(":id/approve")
  approve(@CurrentUser() user: UserProfileSummary, @Param("id") id: string) {
    return this.workflow.approve(user.id, id);
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
