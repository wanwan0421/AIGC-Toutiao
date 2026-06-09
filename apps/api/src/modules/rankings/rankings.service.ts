import { Injectable } from "@nestjs/common";
import { ContentStatus as DbContentStatus, ContentVisibility as DbContentVisibility } from "@prisma/client";
import type {
  ContentSummary,
  OfficialTopicListResponse,
  OfficialTopicSummary,
  RankingListResponse,
  RankingQuery,
  TopicDetail,
} from "@aicp/shared";
import { toContentSummary } from "../../common/prisma-mappers";
import { PrismaService } from "../../infra/prisma/prisma.service";

const OFFICIAL_TOPIC_EMAIL = "topics@toutiao.example.com";

const contentInclude = {
  author: true,
  assets: {
    include: { asset: true },
    orderBy: { sortOrder: "asc" as const },
  },
};

@Injectable()
export class RankingsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: RankingQuery): Promise<RankingListResponse> {
    const limit = this.parseLimit(query.limit, 20);
    const type = query.type ?? "hot";
    const orderBy =
      type === "recommended"
        ? [
            { qualityScore: "desc" as const },
            { heatScore: "desc" as const },
            { publishedAt: "desc" as const },
            { id: "desc" as const },
          ]
        : type === "viral"
          ? [
              { heatScore: "desc" as const },
              { likeCount: "desc" as const },
              { collectCount: "desc" as const },
              { viewCount: "desc" as const },
              { qualityScore: "desc" as const },
              { publishedAt: "desc" as const },
              { id: "desc" as const },
            ]
          : [
              { heatScore: "desc" as const },
              { viewCount: "desc" as const },
              { qualityScore: "desc" as const },
              { publishedAt: "desc" as const },
              { id: "desc" as const },
            ];

    const items = await this.prisma.content.findMany({
      where: {
        status: DbContentStatus.published,
        visibility: DbContentVisibility.public,
        author: { email: { not: OFFICIAL_TOPIC_EMAIL } },
      },
      include: contentInclude,
      orderBy,
      take: limit,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
    });

    return {
      items: items.map(toContentSummary),
      nextCursor: items.length === limit ? items.at(-1)?.id : undefined,
    };
  }

  async topics(rawLimit?: string | number, rawCursor?: string | number): Promise<OfficialTopicListResponse> {
    const limit = this.parseLimit(rawLimit, 8);
    const offset = this.parseOffset(rawCursor);
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

    const aggregates = new Map<string, OfficialTopicSummary & { score: number; latestAt: number }>();
    const now = Date.now();

    for (const content of contents) {
      const contentScore = this.contentCompositeScore(content, now);
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

    return {
      items,
      nextCursor: offset + items.length < sorted.length ? String(offset + items.length) : undefined,
    };
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

    return {
      topic: { ...topic, contentCount: Math.max(topic.contentCount, contents.length) },
      items: contents.map(toContentSummary),
      nextCursor: contents.length === limit ? contents.at(-1)?.id : undefined,
    };
  }

  private parseLimit(raw: string | number | undefined, fallback: number) {
    const value = Number(raw ?? fallback);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(Math.max(Math.trunc(value), 1), 50);
  }

  private parseOffset(raw: string | number | undefined) {
    const value = Number(raw ?? 0);
    if (!Number.isFinite(value)) return 0;
    return Math.max(Math.trunc(value), 0);
  }

  private normalizeTopicName(value: string) {
    return value.trim().replace(/^#+/, "").replace(/\s+/g, "");
  }

  private contentCompositeScore(
    content: {
      heatScore: number;
      qualityScore: number;
      viewCount: number;
      likeCount: number;
      collectCount: number;
      updatedAt: Date;
    },
    now: number
  ) {
    const ageDays = Math.max(0, (now - content.updatedAt.getTime()) / 86_400_000);
    const freshness = Math.max(0, 30 - Math.min(ageDays, 30));
    return (
      content.heatScore +
      content.qualityScore * 0.8 +
      content.viewCount * 0.05 +
      content.likeCount * 2 +
      content.collectCount * 3 +
      freshness
    );
  }
}
