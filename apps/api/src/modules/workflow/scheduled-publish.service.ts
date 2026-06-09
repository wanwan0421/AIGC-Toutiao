import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ContentStatus as DbContentStatus } from "@prisma/client";
import { PrismaService } from "../../infra/prisma/prisma.service";

const POLL_INTERVAL_MS = 60_000;

@Injectable()
export class ScheduledPublishService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduledPublishService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.publishDueContents(), POLL_INTERVAL_MS);
    void this.publishDueContents();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async publishDueContents() {
    if (this.running) return;
    this.running = true;
    try {
      const dueContents = await this.prisma.content.findMany({
        where: {
          status: DbContentStatus.scheduled,
          scheduledAt: { lte: new Date() },
        },
        select: { id: true },
        take: 50,
        orderBy: { scheduledAt: "asc" },
      });

      if (!dueContents.length) return;

      const now = new Date();
      for (const content of dueContents) {
        await this.prisma.content
          .updateMany({
            where: {
              id: content.id,
              status: DbContentStatus.scheduled,
              scheduledAt: { lte: now },
            },
            data: {
              status: DbContentStatus.published,
              publishedAt: now,
              scheduledAt: null,
            },
          })
          .catch((error) => {
            this.logger.warn(`Scheduled publish skipped for ${content.id}: ${(error as Error).message}`);
          });
      }
    } finally {
      this.running = false;
    }
  }
}
