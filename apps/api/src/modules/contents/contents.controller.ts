import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ContentStatus } from "@aicp/shared";
import { ContentsService } from "./contents.service";

@Controller("contents")
export class ContentsController {
  constructor(private readonly contentsService: ContentsService) {}

  @Get()
  list(@Query("status") status?: ContentStatus) {
    return this.contentsService.list(status);
  }

  @Post()
  create(@Body() body: { title?: string; body?: string; tags?: string[]; assetIds?: string[] }) {
    return this.contentsService.create(body);
  }

  @Get(":id")
  detail(@Param("id") id: string) {
    return this.contentsService.detail(id);
  }

  @Get(":id/versions")
  versions(@Param("id") id: string) {
    return this.contentsService.versions(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: { title?: string; body?: string; tags?: string[]; assetIds?: string[] }) {
    return this.contentsService.update(id, body);
  }

  @Post(":id/submit-review")
  submitReview(@Param("id") id: string) {
    return this.contentsService.submitReview(id);
  }

  @Post(":id/approve")
  approve(@Param("id") id: string) {
    return this.contentsService.approve(id);
  }

  @Post(":id/publish")
  publish(@Param("id") id: string) {
    return this.contentsService.publish(id);
  }

  @Post(":id/offline")
  offline(@Param("id") id: string) {
    return this.contentsService.offline(id);
  }
}
