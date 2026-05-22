import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { RedisService } from "../../infra/redis/redis.service";

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService
  ) {}

  async track(body: { contentId: string; eventType: string; userId?: string; metadata?: Record<string, unknown> }) {
    const content = await this.prisma.content.findUnique({ where: { id: body.contentId } });
    if (!content) {
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

  async getContentStats(contentId: string) {
    const content = await this.prisma.content.findUnique({ where: { id: contentId } });
    if (!content) {
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
}
