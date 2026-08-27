import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { CreativeChatMessage } from "@aicp/shared";
import { RedisService } from "../../infra/redis/redis.service";
import { AppError, throwIfAborted } from "../../common/app-error";

const CONVERSATION_HISTORY_CACHE_VERSION = 1;
const CONVERSATION_HISTORY_TTL_SECONDS = 60 * 60 * 2;

type ConversationHistoryCache = {
  version: typeof CONVERSATION_HISTORY_CACHE_VERSION;
  complete: true;
  userId: string;
  conversationId: string;
  generation: number;
  limit: number;
  messages: CreativeChatMessage[];
  cachedAt: string;
};

@Injectable()
export class MemoryService {
  constructor(private readonly redisService: RedisService) {}

  createConversationId() {
    return randomUUID();
  }

  createMessageId() {
    return randomUUID();
  }

  async withConversationLock<T>(conversationId: string, task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquireConversationLock(conversationId, signal);
    try {
      return await task();
    } finally {
      await release();
    }
  }

  async acquireConversationLock(conversationId: string, signal?: AbortSignal) {
    throwIfAborted(signal);
    const client = this.redisService.getClient();
    const key = `ai:conversation:lock:v1:${conversationId}`;
    const token = randomUUID();
    const leaseMs = this.positiveInt(process.env.AI_CHAT_SESSION_LOCK_TTL_MS, 120_000);
    const renewMs = Math.min(this.positiveInt(process.env.AI_CHAT_SESSION_LOCK_RENEW_MS, 30_000), Math.max(1_000, Math.floor(leaseMs / 2)));
    let acquired: string | null;
    try {
      acquired = await client.set(key, token, "PX", leaseMs, "NX");
    } catch (error) {
      throw new AppError({
        code: "CONVERSATION_LOCK_UNAVAILABLE",
        message: "Conversation lock storage is unavailable",
        statusCode: 503,
        retryable: true,
        cause: error,
      });
    }
    if (acquired !== "OK") {
      throw new AppError({
        code: "CONVERSATION_BUSY",
        message: "Another request is already updating this conversation",
        statusCode: 409,
        retryable: true,
        retryAfterMs: 1_000 + Math.floor(Math.random() * 1_000),
      });
    }

    const renewScript = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("PEXPIRE", KEYS[1], tonumber(ARGV[2]))
      end
      return 0
    `;
    const releaseScript = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      end
      return 0
    `;
    const heartbeat = setInterval(() => {
      void client.eval(renewScript, 1, key, token, String(leaseMs)).catch(() => undefined);
    }, renewMs);
    heartbeat.unref?.();

    let released = false;
    return async () => {
      if (released) return;
      released = true;
      clearInterval(heartbeat);
      await client.eval(releaseScript, 1, key, token).catch(() => undefined);
    };
  }

  // 获取对话历史缓存，包括消息列表和生成版本号，如果缓存不存在或不完整则返回 messages 为 null
  async getConversationHistory(input: { userId: string; conversationId: string; limit: number }) {
    const values = await this.redisService.getClient().mget(
      this.conversationHistoryKey(input.conversationId),
      this.conversationGenerationKey(input.conversationId)
    ).catch(() => null);
    const generation = this.parseGeneration(values?.[1]);
    const raw = values?.[0];
    if (!raw) return { messages: null, generation };

    try {
      const cached = JSON.parse(raw) as unknown;
      if (!this.isCompleteConversationHistory(cached, { ...input, generation })) {
        return { messages: null, generation };
      }
      return { messages: cached.messages.slice(-input.limit), generation };
    } catch {
      await this.invalidateConversation(input.conversationId);
      return { messages: null, generation: generation + 1 };
    }
  }

  async setConversationHistory(input: {
    userId: string;
    conversationId: string;
    generation: number;
    limit: number;
    messages: CreativeChatMessage[];
  }) {
    const value: ConversationHistoryCache = {
      version: CONVERSATION_HISTORY_CACHE_VERSION,
      complete: true,
      userId: input.userId,
      conversationId: input.conversationId,
      generation: input.generation,
      limit: input.limit,
      messages: input.messages.slice(-input.limit),
      cachedAt: new Date().toISOString(),
    };
    const script = `
      local current = tonumber(redis.call("GET", KEYS[2]) or "0")
      if current ~= tonumber(ARGV[1]) then return 0 end
      redis.call("SET", KEYS[1], ARGV[2], "EX", tonumber(ARGV[3]))
      return 1
    `;
    await this.redisService.getClient().eval(
      script,
      2,
      this.conversationHistoryKey(input.conversationId),
      this.conversationGenerationKey(input.conversationId),
      String(input.generation),
      JSON.stringify(value),
      String(CONVERSATION_HISTORY_TTL_SECONDS)
    ).catch(() => undefined);
  }

  async appendConversationMessage(input: {
    userId: string;
    conversationId: string;
    message: CreativeChatMessage;
  }) {
    const key = this.conversationHistoryKey(input.conversationId);
    const script = `
      local generation = redis.call("INCR", KEYS[2])
      redis.call("EXPIRE", KEYS[2], tonumber(ARGV[6]))
      local raw = redis.call("GET", KEYS[1])
      if not raw then return 0 end
      local ok, value = pcall(cjson.decode, raw)
      if not ok
        or value.version ~= tonumber(ARGV[1])
        or value.complete ~= true
        or value.userId ~= ARGV[2]
        or value.conversationId ~= ARGV[3]
        or type(value.limit) ~= "number"
        or type(value.messages) ~= "table" then
        redis.call("DEL", KEYS[1])
        return 0
      end
      local message = cjson.decode(ARGV[4])
      for _, existing in ipairs(value.messages) do
        if existing.id == message.id then
          value.generation = generation
          value.cachedAt = ARGV[5]
          redis.call("SET", KEYS[1], cjson.encode(value), "EX", tonumber(ARGV[6]))
          return 1
        end
      end
      table.insert(value.messages, message)
      while #value.messages > value.limit do table.remove(value.messages, 1) end
      value.generation = generation
      value.cachedAt = ARGV[5]
      redis.call("SET", KEYS[1], cjson.encode(value), "EX", tonumber(ARGV[6]))
      return 1
    `;

    try {
      await this.redisService.getClient().eval(
        script,
        2,
        key,
        this.conversationGenerationKey(input.conversationId),
        String(CONVERSATION_HISTORY_CACHE_VERSION),
        input.userId,
        input.conversationId,
        JSON.stringify(input.message),
        new Date().toISOString(),
        String(CONVERSATION_HISTORY_TTL_SECONDS)
      );
    } catch {
      await this.redisService.getClient().del(key).catch(() => undefined);
    }
  }

  async invalidateConversation(conversationId: string) {
    await this.redisService.getClient().multi()
      .incr(this.conversationGenerationKey(conversationId))
      .expire(this.conversationGenerationKey(conversationId), CONVERSATION_HISTORY_TTL_SECONDS)
      .del(this.conversationHistoryKey(conversationId))
      .exec()
      .catch(() => undefined);
  }

  private isCompleteConversationHistory(
    value: unknown,
    input: { userId: string; conversationId: string; limit: number; generation: number }
  ): value is ConversationHistoryCache {
    if (!value || typeof value !== "object") return false;
    const record = value as Partial<ConversationHistoryCache>;
    return record.version === CONVERSATION_HISTORY_CACHE_VERSION
      && record.complete === true
      && record.userId === input.userId
      && record.conversationId === input.conversationId
      && record.generation === input.generation
      && typeof record.limit === "number"
      && record.limit >= input.limit
      && Array.isArray(record.messages)
      && record.messages.length <= record.limit
      && record.messages.every((message) => this.isCreativeChatMessage(message));
  }

  private isCreativeChatMessage(value: unknown): value is CreativeChatMessage {
    if (!value || typeof value !== "object") return false;
    const message = value as Partial<CreativeChatMessage>;
    return (message.role === "user" || message.role === "assistant")
      && typeof message.content === "string"
      && (message.id === undefined || typeof message.id === "string")
      && (message.createdAt === undefined || typeof message.createdAt === "string");
  }

  private conversationHistoryKey(conversationId: string) {
    return `ai:conversation:history:v${CONVERSATION_HISTORY_CACHE_VERSION}:${conversationId}`;
  }

  private conversationGenerationKey(conversationId: string) {
    return `ai:conversation:history-generation:v${CONVERSATION_HISTORY_CACHE_VERSION}:${conversationId}`;
  }

  private parseGeneration(value: string | null | undefined) {
    const generation = Number.parseInt(value ?? "0", 10);
    return Number.isFinite(generation) && generation >= 0 ? generation : 0;
  }

  private positiveInt(value: string | undefined, fallback: number) {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
