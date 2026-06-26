import { Module } from "@nestjs/common";
import { ContentMetricsModule } from "../content-metrics/content-metrics.module";
import { RankingsController } from "./rankings.controller";
import { RankingsService } from "./rankings.service";

@Module({
  imports: [ContentMetricsModule],
  controllers: [RankingsController],
  providers: [RankingsService]
})
export class RankingsModule {}
