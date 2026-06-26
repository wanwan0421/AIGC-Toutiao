import { Injectable } from "@nestjs/common";
import { ContentStatus as DbContentStatus, ContentVisibility as DbContentVisibility } from "@prisma/client";
import type {
  OfficialTopicListResponse,
  OfficialTopicSummary,
  RankingListResponse,
  RankingQuery,
  TopicDetail,
} from "@aicp/shared";
import { toContentSummary } from "../../common/prisma-mappers";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { RedisService } from "../../infra/redis/redis.service";
import { ContentHeatScoreService } from "../content-metrics/content-heat-score.service";
import {
  contentEngagementSignal,
  contentViewSignal,
  normalizeSignal,
  recentContentActionWeight,
  RECENT_CONTENT_SIGNAL_WINDOW_DAYS,
  type ContentSignalCounters,
} from "../content-metrics/content-signals";

const OFFICIAL_TOPIC_EMAIL = "topics@toutiao.example.com";

const contentInclude = {
  author: true,
  assets: {
    include: { asset: true },
    orderBy: { sortOrder: "asc" as const },
  },
  _count: { select: { comments: true } },
};

const RANKING_CACHE_TTL_SECONDS = 30;
const RANKING_CANDIDATE_LIMIT = 500;
const MAX_RANKING_CANDIDATES = 1000;

type RankingType = NonNullable<RankingQuery["type"]>;

type RankingContent = ContentSignalCounters & {
  id: string;
  heatScore: number;
  qualityScore: number;
  publishedAt: Date | null;
  updatedAt: Date;
};

type ScoredContent<T extends RankingContent> = {
  content: T;
  score: number;
};

type ScoringContext = {
  maxViewSignal: number;
  maxEngagementSignal: number;
  maxRecentViralSignal: number;
  recentViralSignals: Map<string, number>;
};

@Injectable()
export class RankingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly heatScores: ContentHeatScoreService
  ) {}

  async list(query: RankingQuery): Promise<RankingListResponse> {
    const limit = this.parseLimit(query.limit, 20);
    const type = this.normalizeRankingType(query.type);
    const offset = this.parseOffset(query.cursor);
    const cacheKey = `rankings:v4:list:${type}:${limit}:${query.cursor || ""}`;
    
    const cached = await this.redisService.getClient().get(cacheKey).catch(() => null);
    if (cached) {
      return this.filterCachedPublicContents(JSON.parse(cached) as RankingListResponse);
    }

    const candidateLimit = Math.min(MAX_RANKING_CANDIDATES, Math.max(RANKING_CANDIDATE_LIMIT, offset + limit * 3));
    const candidates = await this.prisma.content.findMany({
      where: {
        status: DbContentStatus.published,
        visibility: DbContentVisibility.public,
        author: { email: { not: OFFICIAL_TOPIC_EMAIL } },
      },
      include: contentInclude,
      orderBy: this.prefetchOrderBy(type),
      take: candidateLimit,
    });
    const ranked = await this.rankContents(candidates, type);
    const pageStart = this.resolvePageStart(query.cursor, ranked);
    const items = ranked.slice(pageStart, pageStart + limit);
    const normalizedItems = await this.heatScores.normalizeContents(items.map((item) => item.content));

    const result = {
      items: normalizedItems.map(toContentSummary),
      nextCursor: pageStart + items.length < ranked.length ? String(pageStart + items.length) : undefined,
    };
    
    await this.redisService.getClient().setex(cacheKey, RANKING_CACHE_TTL_SECONDS, JSON.stringify(result)).catch(() => undefined);
    return result;
  }

  async topics(rawLimit?: string | number, rawCursor?: string | number): Promise<OfficialTopicListResponse> {
    const limit = this.parseLimit(rawLimit, 8);
    const offset = this.parseOffset(rawCursor);
    const cacheKey = `rankings:v3:topics:${limit}:${offset}`;
    
    const cached = await this.redisService.getClient().get(cacheKey).catch(() => null);
    if (cached) {
      return JSON.parse(cached) as OfficialTopicListResponse;
    }

    const sourceLimit = Math.max(300, Math.min(1000, (offset + limit) * 25));
    const contents = await this.prisma.content.findMany({
      where: {
        status: DbContentStatus.published,
        visibility: DbContentVisibility.public,
        author: { email: { not: OFFICIAL_TOPIC_EMAIL } },
      },
      include: contentInclude,
      orderBy: [
        { heatScore: "desc" },
        { qualityScore: "desc" },
        { updatedAt: "desc" },
      ],
      take: sourceLimit,
    });
    const normalizedContents = await this.heatScores.normalizeContents(contents);
    const scoreByContentId = new Map(normalizedContents.map((content) => [content.id, content.heatScore]));

    const aggregates = new Map<string, OfficialTopicSummary & { score: number; latestAt: number }>();

    for (const content of contents) {
      const contentScore = scoreByContentId.get(content.id) ?? 0;
      for (const tag of content.tags) {
        const title = this.normalizeTopicName(tag);
        if (!title) continue;

        const current = aggregates.get(title);
        const latestAt = content.updatedAt.getTime();
        const coverUrl = content.assets.find((item) => item.asset.mimeType.startsWith("image/"))?.asset.url;

        if (!current) {
          aggregates.set(title, {
            id: `topic-${encodeURIComponent(title)}`,
            title,
            description: "已有 1 篇内容参与讨论，适合快速捕捉近期创作方向。",
            category: "热点",
            heatScore: Math.round(contentScore),
            contentCount: 1,
            coverUrl,
            score: contentScore,
            latestAt,
          });
          continue;
        }

        current.contentCount += 1;
        current.score += contentScore + 12;
        current.heatScore = Math.round(current.score);
        current.description = `已有 ${current.contentCount} 篇内容参与讨论，适合快速捕捉近期创作方向。`;
        if (latestAt > current.latestAt) {
          current.latestAt = latestAt;
          current.coverUrl = coverUrl ?? current.coverUrl;
        }
      }
    }

    const sorted = Array.from(aggregates.values()).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.contentCount !== a.contentCount) return b.contentCount - a.contentCount;
      return b.latestAt - a.latestAt;
    });

    const items = sorted
      .slice(offset, offset + limit)
      .map(({ score: _score, latestAt: _latestAt, ...item }) => item);

    const result = {
      items,
      nextCursor: offset + items.length < sorted.length ? String(offset + items.length) : undefined,
    };
    
    await this.redisService.getClient().setex(cacheKey, RANKING_CACHE_TTL_SECONDS, JSON.stringify(result)).catch(() => undefined);
    return result;
  }

  async topicDetail(rawTitle: string, rawLimit?: string | number, cursor?: string): Promise<TopicDetail> {
    const title = decodeURIComponent(rawTitle);
    const limit = this.parseLimit(rawLimit, 30);
    const topics = await this.topics(100);
    const topic =
      topics.items.find((item) => item.title === title) ??
      ({
        id: `topic-${encodeURIComponent(title)}`,
        title,
        description: `${title} 相关热点内容`,
        category: "热点",
        heatScore: 0,
        contentCount: 0,
      } satisfies OfficialTopicSummary);

    const contents = await this.prisma.content.findMany({
      where: {
        status: DbContentStatus.published,
        visibility: DbContentVisibility.public,
        author: { email: { not: OFFICIAL_TOPIC_EMAIL } },
        OR: [
          { tags: { has: title } },
          { tags: { has: `#${title}` } },
          { title: { contains: title } },
          { body: { contains: title } },
        ],
      },
      include: contentInclude,
      orderBy: [
        { heatScore: "desc" },
        { qualityScore: "desc" },
        { publishedAt: "desc" },
        { id: "desc" },
      ],
      take: limit,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    const normalizedContents = await this.heatScores.normalizeContents(contents);
    return {
      topic: { ...topic, contentCount: Math.max(topic.contentCount, contents.length) },
      items: normalizedContents.map(toContentSummary),
      nextCursor: contents.length === limit ? contents.at(-1)?.id : undefined,
    };
  }

  private parseLimit(raw: string | number | undefined, fallback: number) {
    const value = Number(raw ?? fallback);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(Math.max(Math.trunc(value), 1), 50);
  }

  private normalizeRankingType(type: unknown): RankingType {
    return type === "viral" || type === "recommended" || type === "hot" ? type : "viral";
  }

  private prefetchOrderBy(type: RankingType) {
    if (type === "recommended") {
      return [
        { qualityScore: "desc" as const },
        { updatedAt: "desc" as const },
        { id: "desc" as const },
      ];
    }

    if (type === "hot") {
      return [
        { heatScore: "desc" as const },
        { viewCount: "desc" as const },
        { likeCount: "desc" as const },
        { collectCount: "desc" as const },
        { id: "desc" as const },
      ];
    }

    return [
      { heatScore: "desc" as const },
      { viewCount: "desc" as const },
      { likeCount: "desc" as const },
      { id: "desc" as const },
    ];
  }

  private async rankContents<T extends RankingContent>(contents: T[], type: RankingType): Promise<Array<ScoredContent<T>>> {
    const recentSignals = await this.recentSignals(contents.map((item) => item.id));
    const context = this.buildScoringContext(contents, recentSignals);
    return contents
      .map((content) => ({
        content,
        score: this.contentCompositeScore(content, context, type),
      }))
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        const rightPublishedAt = right.content.publishedAt?.getTime() ?? right.content.updatedAt.getTime();
        const leftPublishedAt = left.content.publishedAt?.getTime() ?? left.content.updatedAt.getTime();
        if (rightPublishedAt !== leftPublishedAt) return rightPublishedAt - leftPublishedAt;
        return right.content.id.localeCompare(left.content.id);
      });
  }

  private async recentSignals(contentIds: string[]) {
    if (!contentIds.length) {
      return {
        viral: new Map<string, number>(),
      };
    }

    const since = new Date(Date.now() - RECENT_CONTENT_SIGNAL_WINDOW_DAYS * 86_400_000);
    const rows = await this.prisma.userActionEvent.groupBy({
      by: ["contentId", "eventType"],
      where: {
        contentId: { in: contentIds },
        createdAt: { gte: since },
      },
      _count: { _all: true },
    });

    const viral = new Map<string, number>();
    for (const row of rows) {
      const viralWeight = recentContentActionWeight(row.eventType);
      if (viralWeight !== 0) {
        viral.set(row.contentId, Math.max(0, (viral.get(row.contentId) ?? 0) + viralWeight * row._count._all));
      }
    }
    return { viral };
  }

  private buildScoringContext(
    contents: RankingContent[],
    recentSignals: { viral: Map<string, number> }
  ): ScoringContext {
    let maxViewSignal = 0;
    let maxEngagementSignal = 0;
    let maxRecentViralSignal = 0;

    for (const content of contents) {
      maxViewSignal = Math.max(maxViewSignal, contentViewSignal(content));
      maxEngagementSignal = Math.max(maxEngagementSignal, contentEngagementSignal(content));
      maxRecentViralSignal = Math.max(maxRecentViralSignal, recentSignals.viral.get(content.id) ?? 0);
    }

    return {
      maxViewSignal,
      maxEngagementSignal,
      maxRecentViralSignal,
      recentViralSignals: recentSignals.viral,
    };
  }

  // Returns a 0-100 score according to the selected ranking mode.
  private contentCompositeScore(content: RankingContent, context: ScoringContext, type: RankingType) {
    const viewScore = normalizeSignal(contentViewSignal(content), context.maxViewSignal);
    const engagementScore = normalizeSignal(contentEngagementSignal(content), context.maxEngagementSignal);
    const recentViralScore = normalizeSignal(context.recentViralSignals.get(content.id) ?? 0, context.maxRecentViralSignal);
    const qualityScore = Math.max(0, Math.min(content.qualityScore, 100)) / 100;
    if (type === "recommended") {
      return Math.round(qualityScore * 1000) / 10;
    }

    const baseScore =
      type === "hot"
        ? recentViralScore * 0.55 + engagementScore * 0.25 + viewScore * 0.2
        : recentViralScore * 0.4 + engagementScore * 0.15 + viewScore * 0.1 + qualityScore * 0.35;

    return Math.round(baseScore * 1000) / 10;
  }

  private resolvePageStart<T extends RankingContent>(cursor: string | undefined, ranked: Array<ScoredContent<T>>) {
    if (!cursor) return 0;
    const offset = Number(cursor);
    if (Number.isFinite(offset)) {
      return Math.max(0, Math.trunc(offset));
    }

    const index = ranked.findIndex((item) => item.content.id === cursor);
    return index >= 0 ? index + 1 : 0;
  }

  private async filterCachedPublicContents(response: RankingListResponse): Promise<RankingListResponse> {
    const ids = response.items.map((item) => item.id);
    if (!ids.length) return response;

    const current = await this.prisma.content.findMany({
      where: {
        id: { in: ids },
        status: DbContentStatus.published,
        visibility: DbContentVisibility.public,
      },
      select: { id: true },
    });
    const visibleIds = new Set(current.map((item) => item.id));
    return {
      ...response,
      items: await this.heatScores.normalizeContents(response.items.filter((item) => visibleIds.has(item.id))),
    };
  }

  private parseOffset(raw: string | number | undefined) {
    const value = Number(raw ?? 0);
    if (!Number.isFinite(value)) return 0;
    return Math.max(Math.trunc(value), 0);
  }

  private normalizeTopicName(value: string) {
    return value.trim().replace(/^#+/, "").replace(/\s+/g, "");
  }
}
