import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor() {
    this.client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null
    });

    this.client.on("error", (error) => {
      this.logger.debug(`Redis client error: ${error.message}`);
    });
  }

  async onModuleInit() {
    try {
      await this.client.connect();
      this.logger.log("Redis connected");
    } catch (error) {
      this.logger.warn(`Redis is not available yet: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy() {
    this.client.disconnect();
  }

  getClient() {
    return this.client;
  }
}
