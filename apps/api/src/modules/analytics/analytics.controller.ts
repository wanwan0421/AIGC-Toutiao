import { Body, Controller, Get, Headers, Param, Post, Query, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { UserProfileSummary } from "@aicp/shared";
import { AuthGuard } from "../auth/auth.guard";
import { AuthService } from "../auth/auth.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { AnalyticsService } from "./analytics.service";

@Controller("analytics")
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly authService: AuthService
  ) {}

  @Post("events")
  async track(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: { contentId: string; eventType: string; userId?: string; metadata?: Record<string, unknown> }
  ) {
    const user = await this.optionalUser(authorization);
    if (!user && !this.isAnonymousEvent(body.eventType)) {
      throw new UnauthorizedException("login required");
    }
    return this.analyticsService.track({ ...body, userId: user?.id });
  }

  @UseGuards(AuthGuard)
  @Get("dashboard")
  getDashboard(
    @CurrentUser() user: UserProfileSummary,
    @Query("range") range?: string,
    @Query("metric") metric?: string
  ) {
    return this.analyticsService.getDashboard(user.id, range, metric);
  }

  @UseGuards(AuthGuard)
  @Get("contents/:contentId")
  getContentStats(@CurrentUser() user: UserProfileSummary, @Param("contentId") contentId: string) {
    return this.analyticsService.getContentStats(user.id, contentId);
  }

  private optionalUser(authorization?: string) {
    return this.authService.me(authorization).catch(() => null);
  }

  private isAnonymousEvent(eventType: string) {
    return eventType === "view" || eventType === "read" || eventType === "click";
  }
}
