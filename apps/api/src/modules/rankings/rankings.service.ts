import { Injectable } from "@nestjs/common";
import type { RankingQuery } from "@aicp/shared";
import { ContentStatus as DbContentStatus } from "@prisma/client";
import { toContentSummary } from "../../common/prisma-mappers";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { RedisService } from "../../infra/redis/redis.service";

@Injectable()
export class RankingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService
  ) {}

  async list(query: RankingQuery) {
    const type = query.type ?? "hot";
    const limit = Math.min(Number(query.limit ?? 20) || 20, 50);
    const cacheKey = `rankings:${type}:${limit}`;
    const cached = await this.redisService
      .getClient()
      .get(cacheKey)
      .catch(() => null);

    if (cached) {
      return {
        source: "redis",
        ...(JSON.parse(cached) as Record<string, unknown>)
      };
    }

    const contents = await this.prisma.content.findMany({
      where: {
        status: { in: [DbContentStatus.published, DbContentStatus.updated, DbContentStatus.approved] }
      },
      include: { author: true },
      orderBy: [{ heatScore: "desc" }, { qualityScore: "desc" }, { updatedAt: "desc" }],
      take: Math.max(limit * 2, 20)
    });

    const items = contents
      .map((item) => {
        const freshnessScore = this.freshnessScore(item.publishedAt ?? item.updatedAt);
        const compositeScore = Math.round(item.qualityScore * 0.45 + item.heatScore * 0.35 + freshnessScore * 0.2);
        return {
          ...toContentSummary(item),
          freshnessScore,
          compositeScore
        };
      })
      .sort((a, b) => b.compositeScore - a.compositeScore)
      .slice(0, limit);

    const payload = {
      type,
      cursor: items.length >= limit ? `cursor_${items.at(-1)?.id ?? "end"}` : null,
      weights: {
        quality: 0.45,
        heat: 0.35,
        freshness: 0.2
      },
      items
    };

    await this.redisService.getClient().set(cacheKey, JSON.stringify(payload), "EX", 60).catch(() => undefined);

    return {
      source: "postgres",
      ...payload
    };
  }

  private freshnessScore(date: Date) {
    const ageMs = Date.now() - date.getTime();
    const ageHours = Math.max(ageMs / 1000 / 60 / 60, 0);
    return Math.max(20, Math.round(100 - ageHours * 2));
  }
}
