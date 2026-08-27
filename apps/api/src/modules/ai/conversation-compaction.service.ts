import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { ConversationArchiveService } from "./conversation-archive.service";
import { ModelClientService, type ModelMessage } from "./model-client.service";
import { completeStructured } from "./structured-output";

const conversationSummarySchema = z.object({
  summary: z.string().min(1).max(6_000),
  facts: z.array(z.string().min(1).max(500)).max(30),
  preferences: z.array(z.string().min(1).max(500)).max(20),
  decisions: z.array(z.string().min(1).max(500)).max(30),
  openThreads: z.array(z.string().min(1).max(500)).max(20),
}).strict();

@Injectable()
export class ConversationCompactionService {
  private readonly logger = new Logger(ConversationCompactionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationArchiveService,
    private readonly modelClient: ModelClientService
  ) {}

  get(conversationId: string) {
    return this.prisma.aiConversationSummary.findUnique({ where: { conversationId } });
  }

  async shouldCompact(conversationId: string, userId: string) {
    const [count, summary] = await Promise.all([
      this.conversations.messageCount(conversationId, userId),
      this.get(conversationId),
    ]);
    const threshold = this.positiveInt(process.env.AI_CHAT_SUMMARY_TRIGGER_MESSAGES, 12);
    const recent = this.positiveInt(process.env.AI_CHAT_REBUILD_RECENT_MESSAGES, 12);
    return count > recent && count - (summary?.coveredMessageCount ?? 0) >= threshold;
  }

  async compact(input: { conversationId: string; userId: string; aiJobId?: string; signal?: AbortSignal }) {
    const messages = await this.conversations.allMessages(input.conversationId, input.userId);
    const recentCount = this.positiveInt(process.env.AI_CHAT_REBUILD_RECENT_MESSAGES, 12);
    const candidates = messages.slice(0, Math.max(0, messages.length - recentCount));
    const existing = await this.get(input.conversationId);
    const start = existing?.throughMessageId
      ? Math.max(0, candidates.findIndex((message) => message.id === existing.throughMessageId) + 1)
      : 0;
    const pending = candidates.slice(start);
    if (!pending.length) return existing;

    const inputBudget = this.positiveInt(process.env.AI_CHAT_REBUILD_MAX_INPUT_TOKENS, 16_000);
    const selected: typeof pending = [];
    let tokens = this.estimateTokens(existing?.summary ?? "");
    for (const message of pending) {
      const next = this.estimateTokens(message.content) + 8;
      if (selected.length && tokens + next > inputBudget) break;
      selected.push(message);
      tokens += next;
    }
    if (!selected.length) return existing;

    const result = await completeStructured({
      modelClient: this.modelClient,
      name: "conversation_compaction",
      schema: conversationSummarySchema,
      apiStyle: "responses",
      cacheStrategy: this.cacheEnabled() ? "prefix" : "off",
      store: false,
      thinking: "disabled",
      temperature: 0.1,
      maxOutputTokens: this.positiveInt(process.env.AI_CHAT_SUMMARY_MAX_OUTPUT_TOKENS, 800),
      telemetry: {
        scene: "conversation_compaction",
        aiJobId: input.aiJobId,
        conversationId: input.conversationId,
        inputSummary: `${selected.length} archived messages`,
      },
      messages: [
        { role: "system", content: COMPACTION_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            previousSummary: existing
              ? {
                  summary: existing.summary,
                  facts: existing.facts,
                  preferences: existing.preferences,
                  decisions: existing.decisions,
                  openThreads: existing.openThreads,
                }
              : null,
            messages: selected.map((message) => ({ role: message.role, content: message.content })),
          }),
        },
      ],
      signal: input.signal,
    });

    const through = selected[selected.length - 1];
    return this.prisma.aiConversationSummary.upsert({
      where: { conversationId: input.conversationId },
      create: {
        conversationId: input.conversationId,
        ...result,
        throughMessageId: through.id,
        coveredMessageCount: (existing?.coveredMessageCount ?? 0) + selected.length,
      },
      update: {
        ...result,
        throughMessageId: through.id,
        coveredMessageCount: (existing?.coveredMessageCount ?? 0) + selected.length,
      },
    });
  }

  async rebuildMessages(input: {
    conversationId: string;
    userId: string;
    currentUserMessageId: string;
    systemPrompt: string;
    currentUserContent: string;
  }): Promise<ModelMessage[]> {
    const [summary, all] = await Promise.all([
      this.get(input.conversationId),
      this.conversations.allMessages(input.conversationId, input.userId),
    ]);
    const recentCount = this.positiveInt(process.env.AI_CHAT_REBUILD_RECENT_MESSAGES, 12);
    const budget = this.positiveInt(process.env.AI_CHAT_REBUILD_MAX_INPUT_TOKENS, 16_000);
    const archived = all.filter((message) => message.id !== input.currentUserMessageId);
    const afterSummary = summary?.throughMessageId
      ? archived.slice(Math.max(0, archived.findIndex((message) => message.id === summary.throughMessageId) + 1))
      : archived;
    const recent = afterSummary.slice(-recentCount);
    const prefix: ModelMessage[] = [{ role: "system", content: input.systemPrompt }];
    if (summary) prefix.push({ role: "system", content: this.formatSummary(summary) });

    let used = prefix.reduce((total, message) => total + this.estimateTokens(message.content), 0)
      + this.estimateTokens(input.currentUserContent);
    const selected: typeof recent = [];
    for (const message of [...recent].reverse()) {
      const cost = this.estimateTokens(message.content) + 8;
      if (selected.length && used + cost > budget) break;
      selected.unshift(message);
      used += cost;
    }
    return [
      ...prefix,
      ...selected.map((message) => ({ role: message.role, content: message.content }) as ModelMessage),
      { role: "user", content: input.currentUserContent },
    ];
  }

  private formatSummary(summary: {
    summary: string;
    facts: string[];
    preferences: string[];
    decisions: string[];
    openThreads: string[];
  }) {
    return [
      "以下是 PostgreSQL 永久归档中较早对话的压缩摘要，仅用于恢复上下文：",
      `阶段摘要：${summary.summary}`,
      `已确认事实：${summary.facts.join("；") || "无"}`,
      `用户偏好：${summary.preferences.join("；") || "无"}`,
      `创作决定：${summary.decisions.join("；") || "无"}`,
      `待处理问题：${summary.openThreads.join("；") || "无"}`,
    ].join("\n");
  }

  private estimateTokens(value: string) {
    let tokens = 0;
    let ascii = 0;
    for (const character of value) {
      if (character.charCodeAt(0) <= 0x7f) ascii += 1;
      else tokens += 1;
    }
    return tokens + Math.ceil(ascii / 4);
  }

  private cacheEnabled() {
    return process.env.AI_CONVERSATION_COMPACTION_CACHE_ENABLED?.trim().toLowerCase() !== "false";
  }

  private positiveInt(value: string | undefined, fallback: number) {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}

const COMPACTION_SYSTEM_PROMPT = `你是创作对话上下文压缩器。请在不虚构信息的前提下合并既有摘要和新增对话。
只保留后续创作真正需要的事实、用户偏好、已经作出的决定和未解决问题；忽略寒暄、重复表达和临时措辞。
不得把建议写成用户已经确认的决定。`;
