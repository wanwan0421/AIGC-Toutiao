import { Controller, Get, Param, Query } from "@nestjs/common";
import type { RankingQuery } from "@aicp/shared";
import { RankingsService } from "./rankings.service";

@Controller("rankings")
export class RankingsController {
  constructor(private readonly rankingsService: RankingsService) {}

  @Get("topics")
  topics(@Query("limit") limit?: string, @Query("cursor") cursor?: string) {
    return this.rankingsService.topics(limit, cursor);
  }

  @Get("topics/:title")
  topicDetail(@Param("title") title: string, @Query("limit") limit?: string, @Query("cursor") cursor?: string) {
    return this.rankingsService.topicDetail(title, limit, cursor);
  }

  @Get()
  list(@Query() query: RankingQuery) {
    return this.rankingsService.list(query);
  }
}
