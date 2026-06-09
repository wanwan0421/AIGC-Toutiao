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

const dashboardContentInclude = {
  author: true,
  assets: {
    include: { asset: true },
    orderBy: { sortOrder: "asc" as const },
  },
  _count: { select: { comments: true } },
};

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
    const now = new Date();
    const periodStart = this.startOfLocalDay(this.addDays(now, -(range - 1)));
    const previousStart = this.startOfLocalDay(this.addDays(periodStart, -range));
    const previousEnd = periodStart;

    const [contents, events] = await Promise.all([
      this.prisma.content.findMany({
        where: { authorId: userId },
        include: dashboardContentInclude,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.userActionEvent.findMany({
        where: {
          createdAt: { gte: previousStart },
          content: { authorId: userId },
        },
        select: {
          eventType: true,
          createdAt: true,
        },
      }),
    ]);

    const trend = this.buildTrend(range, periodStart);
    const currentTotals = this.emptyMetricTotals();
    const previousTotals = this.emptyMetricTotals();

    for (const event of events) {
      const normalized = this.toDashboardMetric(event.eventType);
      if (!normalized) continue;
      const eventTime = event.createdAt.getTime();
      const isCurrent = eventTime >= periodStart.getTime();
      const isPrevious = eventTime >= previousStart.getTime() && eventTime < previousEnd.getTime();

      if (isCurrent) {
        currentTotals[normalized] += 1;
        currentTotals.heat += this.heatWeight(event.eventType);
        const day = this.dayKey(event.createdAt);
        const point = trend.find((item) => item.date === day);
        if (point) {
          point[normalized] += 1;
          point.heat += this.heatWeight(event.eventType);
        }
      } else if (isPrevious) {
        previousTotals[normalized] += 1;
        previousTotals.heat += this.heatWeight(event.eventType);
      }
    }

    return {
      range,
      metric,
      period: {
        start: periodStart.toISOString(),
        end: now.toISOString(),
      },
      latestWork: contents[0] ? toContentSummary(contents[0]) : undefined,
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
