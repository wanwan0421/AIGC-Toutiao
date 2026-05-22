import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { DraftsService } from "./drafts.service";

@Controller("drafts")
export class DraftsController {
  constructor(private readonly draftsService: DraftsService) {}

  @Get(":contentId")
  getDraft(@Param("contentId") contentId: string) {
    return this.draftsService.getDraft(contentId);
  }

  @Put(":contentId/autosave")
  autosave(
    @Param("contentId") contentId: string,
    @Body() body: { title?: string; body?: string; payload?: Record<string, unknown>; clientHash?: string }
  ) {
    return this.draftsService.autosave(contentId, body);
  }
}
