import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { CreativeChatMessage } from "@aicp/shared";
import { RedisService } from "../../infra/redis/redis.service";

@Injectable()
export class MemoryService {
  constructor(private readonly redisService: RedisService) {}

  createConversationId() {
    return randomUUID();
  }

  createMessageId() {
    return randomUUID();
  }

  async getShortTermMessages(input: { userId: string; contentId: string; conversationId: string }) {
    const raw = await this.redisService
      .getClient()
      .get(this.key(input))
      .catch(() => null);
    if (!raw) return [];

    try {
      return JSON.parse(raw) as CreativeChatMessage[];
    } catch {
      return [];
    }
  }

  async appendShortTermMessages(
    input: { userId: string; contentId: string; conversationId: string },
    messages: CreativeChatMessage[]
  ) {
    const current = await this.getShortTermMessages(input);
    const next = [...current, ...messages].slice(-12);
    await this.redisService
      .getClient()
      .set(this.key(input), JSON.stringify(next), "EX", 60 * 60 * 2)
      .catch(() => undefined);
    return next;
  }

  private key(input: { userId: string; contentId: string; conversationId: string }) {
    return `ai:creative:ctx:${input.userId}:${input.contentId}:${input.conversationId}`;
  }
}
