import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";

@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Post("events")
  track(@Body() body: { contentId: string; eventType: string; userId?: string; metadata?: Record<string, unknown> }) {
    return this.analyticsService.track(body);
  }

  @Get("contents/:contentId")
  getContentStats(@Param("contentId") contentId: string) {
    return this.analyticsService.getContentStats(contentId);
  }
}
