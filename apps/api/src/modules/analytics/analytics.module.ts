import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ContentMetricsModule } from "../content-metrics/content-metrics.module";
import { ContentsModule } from "../contents/contents.module";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";

@Module({
  imports: [AuthModule, ContentMetricsModule, ContentsModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService]
})
export class AnalyticsModule {}
