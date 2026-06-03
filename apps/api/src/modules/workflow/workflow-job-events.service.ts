import { Injectable, Logger } from "@nestjs/common";
import type { AiJobEvent } from "@aicp/shared";
import { RedisService } from "../../infra/redis/redis.service";

@Injectable()
export class WorkflowJobEventsService {
  private readonly logger = new Logger(WorkflowJobEventsService.name);

  constructor(private readonly redisService: RedisService) {}

  channel(jobId: string) {
    return `ai-job:${jobId}:events`;
  }

  // Redis 只是实时通知通道；任务状态真源始终是 AiJob 表。
  async publish(jobId: string, event: AiJobEvent) {
    await this.redisService
      .getClient()
      .publish(this.channel(jobId), JSON.stringify(event))
      .catch((error) => {
        this.logger.debug(`AI job event publish skipped: ${(error as Error).message}`);
      });
  }
}
