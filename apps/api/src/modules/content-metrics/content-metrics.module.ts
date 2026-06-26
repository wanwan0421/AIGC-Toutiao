import { Module } from "@nestjs/common";
import { ContentHeatScoreService } from "./content-heat-score.service";

@Module({
  providers: [ContentHeatScoreService],
  exports: [ContentHeatScoreService],
})
export class ContentMetricsModule {}
