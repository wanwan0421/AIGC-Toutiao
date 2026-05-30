import { Injectable } from "@nestjs/common";
import type { OfficialTopicSummary, RankingQuery } from "@aicp/shared";
import { ContentStatus as DbContentStatus } from "@prisma/client";
import { toContentSummary } from "../../common/prisma-mappers";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { RedisService } from "../../infra/redis/redis.service";

const OFFICIAL_TOPIC_AUTHOR_EMAILS = ["topics@toutiao.example.com", "official@example.com"];
const PUBLIC_RANKING_STATUSES = [DbContentStatus.published];

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
        status: { in: PUBLIC_RANKING_STATUSES }
      },
      include: {
        author: true,
        assets: {
          include: { asset: true },
          orderBy: { sortOrder: "asc" }
        }
      },
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

  async topics(rawLimit?: string | number) {
    const limit = Math.min(Number(rawLimit ?? 8) || 8, 20);
    const officialContents = await this.findTopicContents(true);
    const sourceContents = officialContents.length ? officialContents : await this.findTopicContents(false);
    const topics = new Map<
      string,
      OfficialTopicSummary & {
        samples: string[];
      }
    >();

    for (const content of sourceContents) {
      const summary = toContentSummary(content);
      const tags = content.tags.length ? content.tags : [content.title];

      for (const rawTag of tags) {
        const title = rawTag.replace(/^#+/, "").trim();
        if (!title) continue;

        const current =
          topics.get(title) ??
          ({
            id: encodeURIComponent(title),
            title,
            description: summary.excerpt,
            category: content.tags[0] ?? "热门创作",
            heatScore: 0,
            contentCount: 0,
            coverUrl: summary.coverUrl,
            samples: []
          } satisfies OfficialTopicSummary & { samples: string[] });

        current.heatScore += content.heatScore + Math.round(content.viewCount / 120) + content.likeCount * 2 + content.collectCount * 3;
        current.contentCount += 1;
        current.coverUrl = current.coverUrl ?? summary.coverUrl;
        if (summary.excerpt && current.samples.length < 2) {
          current.samples.push(summary.excerpt);
        }
        current.description = current.samples[0] ?? current.description;
        topics.set(title, current);
      }
    }

    return {
      items: [...topics.values()]
        .sort((left, right) => right.heatScore - left.heatScore)
        .slice(0, limit)
        .map(({ samples: _samples, ...topic }) => topic)
    };
  }

  private findTopicContents(officialOnly: boolean) {
    return this.prisma.content.findMany({
      where: {
        status: { in: PUBLIC_RANKING_STATUSES },
        ...(officialOnly
          ? {
              author: {
                email: { in: OFFICIAL_TOPIC_AUTHOR_EMAILS }
              }
            }
          : {})
      },
      include: {
        author: true,
        assets: {
          include: { asset: true },
          orderBy: { sortOrder: "asc" }
        }
      },
      orderBy: [{ heatScore: "desc" }, { viewCount: "desc" }, { updatedAt: "desc" }],
      take: 100
    });
  }

  private freshnessScore(date: Date) {
    const ageMs = Date.now() - date.getTime();
    const ageHours = Math.max(ageMs / 1000 / 60 / 60, 0);
    return Math.max(20, Math.round(100 - ageHours * 2));
  }
}
