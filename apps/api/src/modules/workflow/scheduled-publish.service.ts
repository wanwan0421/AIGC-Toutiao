import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
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
          status: 'scheduled',
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
              status: 'scheduled',
              scheduledAt: { lte: now },
            },
            data: {
              status: 'published',
              publishedAt: now,
              scheduledAt: null,
            },
          })
          .catch((error: Error) => {
            this.logger.warn(`Scheduled publish skipped for ${content.id}: ${error.message}`);
          });
      }
    } finally {
      this.running = false;
    }
  }
}
