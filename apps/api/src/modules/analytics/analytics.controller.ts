import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import type { UserProfileSummary } from "@aicp/shared";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { AnalyticsService } from "./analytics.service";

@UseGuards(AuthGuard)
@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Post("events")
  track(
    @CurrentUser() user: UserProfileSummary,
    @Body() body: { contentId: string; eventType: string; userId?: string; metadata?: Record<string, unknown> }
  ) {
    return this.analyticsService.track({ ...body, userId: user.id });
  }

  @Get("dashboard")
  getDashboard(
    @CurrentUser() user: UserProfileSummary,
    @Query("range") range?: string,
    @Query("metric") metric?: string
  ) {
    return this.analyticsService.getDashboard(user.id, range, metric);
  }

  @Get("contents/:contentId")
  getContentStats(@CurrentUser() user: UserProfileSummary, @Param("contentId") contentId: string) {
    return this.analyticsService.getContentStats(user.id, contentId);
  }
}
