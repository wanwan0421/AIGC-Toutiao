import { Module } from "@nestjs/common";
import { RankingsController } from "./rankings.controller";
import { RankingsService } from "./rankings.service";

@Module({
  controllers: [RankingsController],
  providers: [RankingsService]
})
export class RankingsModule {}
