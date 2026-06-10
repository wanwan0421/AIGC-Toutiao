import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { DashboardAnalyticsResponse, DashboardMetric } from "@aicp/shared";
import { toContentSummary } from "../../common/prisma-mappers";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { RedisService } from "../../infra/redis/redis.service";
import { ContentAccessPolicyService } from "../contents/content-access-policy.service";

const dashboardMetricLabels: Record<DashboardMetric, string> = {
  view: "阅读量",
  click: "访问量",
  like: "点赞数",
  collect: "收藏数",
  comment: "评论数",
  heat: "热度",
};

const dashboardMetrics: DashboardMetric[] = ["view", "click", "like", "collect", "comment", "heat"];

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly accessPolicy: ContentAccessPolicyService
  ) {}

  async track(body: { contentId: string; eventType: string; userId?: string; metadata?: Record<string, unknown> }) {
    const content = await this.prisma.content.findUnique({
      where: { id: body.contentId },
      select: { id: true, authorId: true, status: true, visibility: true },
    });
    if (!content || !(await this.accessPolicy.canView(body.userId, content))) {
      throw new NotFoundException("content not found");
    }

    const event = await this.prisma.userActionEvent.create({
      data: {
        contentId: body.contentId,
        userId: body.userId,
        eventType: body.eventType,
        metadata: body.metadata as Prisma.InputJsonValue | undefined
      }
    });

    const updated = await this.applyCounters(body.contentId, body.eventType);

    await this.redisService
      .getClient()
      .hincrby(`content:counters:${body.contentId}`, body.eventType, 1)
      .catch(() => undefined);

    return {
      ok: true,
      sink: "postgres-event-and-redis-counter",
      event,
      counters: this.pickCounters(updated)
    };
  }

  async getContentStats(userId: string, contentId: string) {
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
      select: {
        id: true,
        authorId: true,
        status: true,
        visibility: true,
        viewCount: true,
        likeCount: true,
        collectCount: true,
        clickCount: true,
        heatScore: true,
      },
    });
    if (!content || !(await this.accessPolicy.canView(userId, content))) {
      throw new NotFoundException("content not found");
    }

    const redisCounters = await this.redisService
      .getClient()
      .hgetall(`content:counters:${contentId}`)
      .catch(() => ({}));

    return {
      contentId,
      counters: this.pickCounters(content),
      redisCounters
    };
  }

  async getDashboard(userId: string, rawRange?: string | number, rawMetric?: string): Promise<DashboardAnalyticsResponse> {
    const range = Number(rawRange) === 30 ? 30 : 7;
    const metric = dashboardMetrics.includes(rawMetric as DashboardMetric) ? (rawMetric as DashboardMetric) : "view";
    const cacheKey = `dashboard:v3:${userId}:${range}:${metric}`;
    const cached = await this.redisService.getClient().get(cacheKey).catch(() => null);
    if (cached) {
      return JSON.parse(cached) as DashboardAnalyticsResponse;
    }

    const now = new Date();
    const periodStart = this.startOfLocalDay(this.addDays(now, -(range - 1)));
    const previousStart = this.startOfLocalDay(this.addDays(periodStart, -range));

    const [latestContentAgg, dailyAggregations] = await Promise.all([
      this.prisma.content.findFirst({
        where: { authorId: userId },
        include: {
          author: true,
          assets: {
            include: { asset: true },
            orderBy: { sortOrder: "asc" as const },
          },
          _count: { select: { comments: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.$queryRaw<Array<{ event_date: Date; event_type: string; count: bigint }>>`
        SELECT 
          DATE_TRUNC('day', "createdAt")::date as event_date,
          "eventType" as event_type,
          COUNT(*)::bigint as count
        FROM "UserActionEvent"
        WHERE 
          "contentId" IN (SELECT id FROM "Content" WHERE "authorId" = ${userId})
          AND "createdAt" >= ${previousStart}::timestamp
        GROUP BY DATE_TRUNC('day', "createdAt")::date, "eventType"
        ORDER BY event_date, event_type
      `,
    ]);

    const trend = this.buildTrend(range, periodStart);
    const currentTotals = this.emptyMetricTotals();
    const previousTotals = this.emptyMetricTotals();

    for (const agg of dailyAggregations) {
      const normalized = this.toDashboardMetric(agg.event_type);
      if (!normalized) continue;
      const eventDate = new Date(agg.event_date);
      const eventTime = eventDate.getTime();
      const isCurrent = eventTime >= periodStart.getTime();
      const isPrevious = eventTime >= previousStart.getTime() && eventTime < periodStart.getTime();

      if (isCurrent) {
        currentTotals[normalized] += Number(agg.count);
        currentTotals.heat += this.heatWeight(agg.event_type) * Number(agg.count);
        const dayLabel = this.dayKey(eventDate);
        const point = trend.find((item) => item.date === dayLabel);
        if (point) {
          point[normalized] += Number(agg.count);
          point.heat += this.heatWeight(agg.event_type) * Number(agg.count);
        }
      } else if (isPrevious) {
        previousTotals[normalized] += Number(agg.count);
        previousTotals.heat += this.heatWeight(agg.event_type) * Number(agg.count);
      }
    }

    const result: DashboardAnalyticsResponse = {
      range,
      metric,
      period: {
        start: periodStart.toISOString(),
        end: now.toISOString(),
      },
      latestWork: latestContentAgg ? toContentSummary(latestContentAgg) : undefined,
      metrics: Object.fromEntries(
        dashboardMetrics.map((item) => [
          item,
          {
            metric: item,
            label: dashboardMetricLabels[item],
            total: currentTotals[item],
            delta: currentTotals[item] - previousTotals[item],
          },
        ])
      ) as DashboardAnalyticsResponse["metrics"],
      trend,
    };
    
    await this.redisService.getClient().setex(cacheKey, 180, JSON.stringify(result)).catch(() => undefined);
    return result;
  }

  private applyCounters(contentId: string, eventType: string) {
    if (eventType === "view" || eventType === "read") {
      return this.prisma.content.update({
        where: { id: contentId },
        data: {
          viewCount: { increment: 1 },
          heatScore: { increment: 1 }
        }
      });
    }

    if (eventType === "like") {
      return this.prisma.content.update({
        where: { id: contentId },
        data: {
          likeCount: { increment: 1 },
          heatScore: { increment: 2 }
        }
      });
    }

    if (eventType === "collect") {
      return this.prisma.content.update({
        where: { id: contentId },
        data: {
          collectCount: { increment: 1 },
          heatScore: { increment: 2 }
        }
      });
    }

    if (eventType === "click") {
      return this.prisma.content.update({
        where: { id: contentId },
        data: {
          clickCount: { increment: 1 },
          heatScore: { increment: 1 }
        }
      });
    }

    return this.prisma.content.findUniqueOrThrow({ where: { id: contentId } });
  }

  private pickCounters(content: {
    viewCount: number;
    likeCount: number;
    collectCount: number;
    clickCount: number;
    heatScore: number;
  }) {
    return {
      viewCount: content.viewCount,
      likeCount: content.likeCount,
      collectCount: content.collectCount,
      clickCount: content.clickCount,
      heatScore: content.heatScore
    };
  }

  private buildTrend(range: 7 | 30, start: Date) {
    return Array.from({ length: range }, (_, index) => {
      const date = this.addDays(start, index);
      const label = date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }).replace(/\//g, "-");
      return {
        date: this.dayKey(date),
        label,
        view: 0,
        click: 0,
        like: 0,
        collect: 0,
        comment: 0,
        heat: 0,
      };
    });
  }

  private emptyMetricTotals() {
    return {
      view: 0,
      click: 0,
      like: 0,
      collect: 0,
      comment: 0,
      heat: 0,
    };
  }

  private toDashboardMetric(eventType: string): Exclude<DashboardMetric, "heat"> | null {
    if (eventType === "view" || eventType === "read") return "view";
    if (eventType === "click") return "click";
    if (eventType === "like") return "like";
    if (eventType === "collect") return "collect";
    if (eventType === "comment") return "comment";
    return null;
  }

  private heatWeight(eventType: string) {
    if (eventType === "like" || eventType === "collect") return 2;
    return eventType === "view" || eventType === "read" || eventType === "click" || eventType === "comment" ? 1 : 0;
  }

  private startOfLocalDay(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private addDays(date: Date, days: number) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  private dayKey(date: Date) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

}
