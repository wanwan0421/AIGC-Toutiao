import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type Redis from "ioredis";
import type { AiJobEvent, AiJobEventType } from "@aicp/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { RedisService } from "../../infra/redis/redis.service";

const STREAM_MAX_LENGTH = 1_000;
const STREAM_TTL_SECONDS = 24 * 60 * 60;
const REPLAY_BATCH_SIZE = 500;

type StreamReadResult = {
  cursor: string;
  events: AiJobEvent[];
};

@Injectable()
export class WorkflowJobEventsService {
  private readonly logger = new Logger(WorkflowJobEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService
  ) {}

  streamKey(jobId: string) {
    return `ai-job:${jobId}:events`;
  }

  async publish(jobId: string, event: Omit<AiJobEvent, "id">): Promise<AiJobEvent> {
    const storedEvent = await this.createInTransaction(this.prisma, jobId, event);
    await this.notify(jobId, storedEvent);
    return storedEvent;
  }

  async createInTransaction(
    tx: Pick<Prisma.TransactionClient, "aiJobEvent">,
    jobId: string,
    event: Omit<AiJobEvent, "id">
  ): Promise<AiJobEvent> {
    const persisted = await tx.aiJobEvent.create({
      data: {
        jobId,
        type: event.type,
        data: event.data as Prisma.InputJsonValue,
      },
    });
    return {
      id: persisted.id.toString(),
      type: event.type,
      data: event.data,
    };
  }

  async notify(jobId: string, storedEvent: AiJobEvent) {
    const client = this.redisService.getClient();
    await client
      .xadd(
        this.streamKey(jobId),
        "MAXLEN",
        "~",
        STREAM_MAX_LENGTH,
        "*",
        "event",
        JSON.stringify(storedEvent)
      )
      .then(() => client.expire(this.streamKey(jobId), STREAM_TTL_SECONDS))
      .catch((error) => {
        this.logger.debug(`AI job stream publish skipped: ${(error as Error).message}`);
      });

  }

  async listAfter(jobId: string, lastEventId?: string, take = REPLAY_BATCH_SIZE): Promise<AiJobEvent[]> {
    const events = await this.prisma.aiJobEvent.findMany({
      where: {
        jobId,
        ...(this.parseEventId(lastEventId) !== null ? { id: { gt: this.parseEventId(lastEventId)! } } : {}),
      },
      orderBy: { id: "asc" },
      take,
    });

    return events.map((event) => ({
      id: event.id.toString(),
      type: event.type as AiJobEventType,
      data: this.asRecord(event.data),
    }));
  }

  async latestStreamId(client: Redis, jobId: string): Promise<string> {
    const entries = await client.xrevrange(this.streamKey(jobId), "+", "-", "COUNT", 1);
    return entries[0]?.[0] ?? "$";
  }

  async readStream(
    client: Redis,
    jobId: string,
    cursor: string,
    blockMs: number
  ): Promise<StreamReadResult> {
    const result = await client.xread(
      "COUNT",
      100,
      "BLOCK",
      blockMs,
      "STREAMS",
      this.streamKey(jobId),
      cursor
    );
    if (!result?.length) return { cursor, events: [] };

    let nextCursor = cursor;
    const events: AiJobEvent[] = [];
    for (const [, entries] of result) {
      for (const [streamId, fields] of entries) {
        nextCursor = streamId;
        const payloadIndex = fields.indexOf("event");
        if (payloadIndex < 0 || payloadIndex + 1 >= fields.length) continue;
        const event = this.parseStoredEvent(fields[payloadIndex + 1]);
        if (event) events.push(event);
      }
    }
    return { cursor: nextCursor, events };
  }

  isAfter(eventId: string | undefined, lastEventId: string | undefined) {
    const current = this.parseEventId(eventId);
    const last = this.parseEventId(lastEventId);
    if (current === null) return true;
    if (last === null) return true;
    return current > last;
  }

  private parseEventId(value?: string) {
    const normalized = value?.trim();
    if (!normalized || !/^\d+$/.test(normalized)) return null;
    try {
      return BigInt(normalized);
    } catch {
      return null;
    }
  }

  private parseStoredEvent(value: string): AiJobEvent | null {
    try {
      const parsed = JSON.parse(value) as Partial<AiJobEvent>;
      if (!parsed.id || !parsed.type || !parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) {
        return null;
      }
      return {
        id: parsed.id,
        type: parsed.type,
        data: parsed.data as Record<string, unknown>,
      };
    } catch {
      return null;
    }
  }

  private asRecord(value: Prisma.JsonValue): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }
}
