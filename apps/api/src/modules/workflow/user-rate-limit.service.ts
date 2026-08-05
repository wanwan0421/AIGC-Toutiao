import { Injectable } from "@nestjs/common";
import { AppError } from "../../common/app-error";
import { RedisService } from "../../infra/redis/redis.service";

@Injectable()
export class UserRateLimitService {
  constructor(private readonly redis: RedisService) {}

  async consume(userId: string, bucket: "write" | "ai" | "image" | "upload") {
    const policy = bucket === "write" ? [60, 60] : bucket === "ai" ? [10, 60] : bucket === "image" ? [5, 600] : [20, 600];
    const [limit, seconds] = policy;
    const window = Math.floor(Date.now() / (seconds * 1_000));
    const key = `rate:${bucket}:${userId}:${window}`;
    try {
      const count = await this.redis.getClient().incr(key);
      if (count === 1) await this.redis.getClient().expire(key, seconds + 1);
      if (count > limit) {
        const ttl = Math.max(1, await this.redis.getClient().ttl(key));
        throw new AppError({ code: "RATE_LIMITED", message: "请求过于频繁，请稍后重试", statusCode: 429, retryable: true, retryAfterMs: ttl * 1_000 });
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      // Availability wins if Redis is temporarily unavailable; durable job
      // concurrency is still enforced by the database query below.
    }
  }
}
