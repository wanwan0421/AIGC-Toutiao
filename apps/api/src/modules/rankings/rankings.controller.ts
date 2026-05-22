import { Controller, Get, Query } from "@nestjs/common";
import type { RankingQuery } from "@aicp/shared";
import { RankingsService } from "./rankings.service";

@Controller("rankings")
export class RankingsController {
  constructor(private readonly rankingsService: RankingsService) {}

  @Get()
  list(@Query() query: RankingQuery) {
    return this.rankingsService.list(query);
  }
}
