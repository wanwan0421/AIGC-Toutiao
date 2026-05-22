import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { AssetsService } from "./assets.service";

@Controller("assets")
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Get()
  list(@Query("contentId") contentId?: string) {
    return this.assetsService.list(contentId);
  }

  @Post()
  create(@Body() body: { fileName: string; mimeType: string; url: string; contentId?: string }) {
    return this.assetsService.create(body);
  }

  @Post(":id/link/:contentId")
  link(@Param("id") id: string, @Param("contentId") contentId: string) {
    return this.assetsService.link(id, contentId);
  }
}
