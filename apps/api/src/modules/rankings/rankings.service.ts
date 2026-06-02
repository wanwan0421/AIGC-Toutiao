import { Injectable } from "@nestjs/common";
import { ContentStatus as DbContentStatus } from "@prisma/client";
import type { ContentSummary, OfficialTopicSummary, RankingQuery, TopicDetail } from "@aicp/shared";
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

  async list(query: RankingQuery): Promise<{ items: ContentSummary[]; nextCursor?: string }> {
    const limit = this.parseLimit(query.limit, 20);
    const orderBy =
      query.type === "recommended"
        ? [{ qualityScore: "desc" as const }, { heatScore: "desc" as const }]
        : query.type === "viral"
          ? [{ likeCount: "desc" as const }, { collectCount: "desc" as const }, { heatScore: "desc" as const }]
          : [{ heatScore: "desc" as const }, { viewCount: "desc" as const }];

    const items = await this.prisma.content.findMany({
      where: {
        status: DbContentStatus.published,
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

  async topics(rawLimit?: string | number): Promise<{ items: OfficialTopicSummary[] }> {
    const limit = this.parseLimit(rawLimit, 8);
    const officialItems = await this.prisma.content.findMany({
      where: {
        status: DbContentStatus.published,
        author: { email: OFFICIAL_TOPIC_EMAIL },
      },
      include: contentInclude,
      orderBy: [{ heatScore: "desc" }, { updatedAt: "desc" }],
      take: limit,
    });

    const items = await Promise.all(
      officialItems.map(async (content) => {
        const title = this.topicTitle(content.title);
        const contentCount = await this.countTopicContents(title);
        return {
          id: content.id,
          title,
          description: content.excerpt ?? content.body.slice(0, 72),
          category: "热门创作",
          heatScore: content.heatScore,
          contentCount,
          coverUrl: content.assets[0]?.asset.url,
        };
      })
    );

    return { items };
  }

  async topicDetail(rawTitle: string, rawLimit?: string | number): Promise<TopicDetail> {
    const title = decodeURIComponent(rawTitle);
    const limit = this.parseLimit(rawLimit, 30);
    const topics = await this.topics(50);
    const topic =
      topics.items.find((item) => item.title === title) ??
      ({
        id: `topic-${encodeURIComponent(title)}`,
        title,
        description: `${title} 相关创作内容`,
        category: "热门创作",
        heatScore: 0,
        contentCount: 0,
      } satisfies OfficialTopicSummary);

    const contents = await this.prisma.content.findMany({
      where: {
        status: DbContentStatus.published,
        author: { email: { not: OFFICIAL_TOPIC_EMAIL } },
        OR: [
          { tags: { has: title } },
          { tags: { has: `#${title}` } },
          { title: { contains: title } },
          { body: { contains: title } },
        ],
      },
      include: contentInclude,
      orderBy: [{ heatScore: "desc" }, { updatedAt: "desc" }],
      take: limit,
    });

    return {
      topic: { ...topic, contentCount: Math.max(topic.contentCount, contents.length) },
      items: contents.map(toContentSummary),
    };
  }

  private async countTopicContents(title: string) {
    return this.prisma.content.count({
      where: {
        status: DbContentStatus.published,
        author: { email: { not: OFFICIAL_TOPIC_EMAIL } },
        OR: [
          { tags: { has: title } },
          { tags: { has: `#${title}` } },
          { title: { contains: title } },
          { body: { contains: title } },
        ],
      },
    });
  }

  private parseLimit(raw: string | number | undefined, fallback: number) {
    const value = Number(raw ?? fallback);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(Math.max(Math.trunc(value), 1), 50);
  }

  private topicTitle(title: string) {
    return title.replace(/^官方话题[:：]\s*/, "").trim();
  }
}
