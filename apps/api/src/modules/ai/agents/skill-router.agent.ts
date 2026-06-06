import { Injectable, Logger } from "@nestjs/common";
import type { AiSkillKey } from "@aicp/shared";
import { ModelClientService } from "../model-client.service";
import { parseJsonObject } from "../structured-output";
import { SkillRegistryService } from "../skills-runtime/skill-registry.service";
import type { SkillRouterDecision } from "../skills-runtime/skill-runtime.types";

type RouterInput = {
  message: string;
  currentTitle?: string;
  currentBody?: string;
  selectedText?: string;
  historyText?: string;
};

const ALLOWED_SKILLS: AiSkillKey[] = ["content-production-line", "content-safety-reviewer"];

@Injectable()
export class SkillRouterAgent {
  private readonly logger = new Logger(SkillRouterAgent.name);

  constructor(
    private readonly modelClient: ModelClientService,
    private readonly registry: SkillRegistryService
  ) {}

  async decide(input: RouterInput): Promise<SkillRouterDecision> {
    const fallback = this.heuristicDecision(input);
    if (!this.modelClient.hasRemoteProvider()) {
      return fallback;
    }

    try {
      const content = await this.modelClient.complete({
        temperature: 0.05,
        messages: [
          {
            role: "system",
            content: this.systemPrompt(),
          },
          {
            role: "user",
            content: this.userPrompt(input),
          },
        ],
      });
      const parsed = parseJsonObject<Partial<SkillRouterDecision>>(content);
      const normalized = this.normalize(parsed);
      return normalized ?? fallback;
    } catch (error) {
      this.logger.debug(`Skill router fallback used: ${(error as Error).message}`);
      return fallback;
    }
  }

  private systemPrompt() {
    return [
      "You are the Skill Router for a Chinese AI content creation platform.",
      "Only return valid JSON. Do not explain your reasoning.",
      "",
      "Available skills. Only name and description are available at routing time:",
      JSON.stringify(this.registry.listForRouter(), null, 2),
      "",
      "Allowed actions:",
      "- chat: ordinary conversation, ideation, local writing help, title suggestions, or explanation.",
      "- ask_clarification: ask a short question when a clearly requested skill lacks required input.",
      "- run_skill: run exactly one allowed skill.",
      "",
      "Routing rules:",
      "- Choose content-production-line only when the user asks for a complete article/draft/package with title, body, tags, cover suggestion, or images.",
      "- Choose content-safety-reviewer when the user asks to review, audit, check compliance, check publishability, or find safety risks.",
      "- Do not choose a skill for ordinary questions, partial paragraph/opening generation, title-only generation, selection rewrite, brainstorming, or explanations.",
      "- If the user clearly wants an audit but there is no title or body, ask_clarification.",
      "",
      "Return JSON shape:",
      '{"action":"chat|run_skill|ask_clarification","skillKey":"content-production-line|content-safety-reviewer","confidence":0.9,"message":"short user-facing status","input":{}}',
    ].join("\n");
  }

  private userPrompt(input: RouterInput) {
    return JSON.stringify(
      {
        message: input.message,
        currentTitle: input.currentTitle ?? "",
        currentBodySummary: this.summarize(input.currentBody),
        selectedText: input.selectedText ?? "",
        recentConversation: input.historyText ?? "",
      },
      null,
      2
    );
  }

  private normalize(value: Partial<SkillRouterDecision> | null | undefined): SkillRouterDecision | null {
    if (!value || typeof value.action !== "string") return null;
    if (value.action === "chat") {
      return { action: "chat", confidence: this.confidence(value.confidence), message: value.message };
    }
    if (value.action === "ask_clarification") {
      return {
        action: "ask_clarification",
        confidence: this.confidence(value.confidence),
        message: value.message ?? "我还需要更多信息才能继续。",
      };
    }
    if (value.action === "run_skill" && ALLOWED_SKILLS.includes(value.skillKey as AiSkillKey)) {
      return {
        action: "run_skill",
        skillKey: value.skillKey as AiSkillKey,
        confidence: this.confidence(value.confidence),
        message: value.message,
        input: value.input && typeof value.input === "object" ? value.input : {},
      };
    }
    return null;
  }

  private heuristicDecision(input: RouterInput): SkillRouterDecision {
    const text = input.message.toLowerCase();
    if (/(审核|合规|能不能发|能否发布|发布前|安全|风险|违规)/.test(input.message)) {
      const hasContent = Boolean(input.currentTitle?.trim() || input.currentBody?.trim());
      return hasContent
        ? {
            action: "run_skill",
            skillKey: "content-safety-reviewer",
            confidence: 0.82,
            message: "正在为当前内容启动安全审核。",
          }
        : {
            action: "ask_clarification",
            confidence: 0.82,
            message: "请先提供要审核的标题或正文，或者在编辑器里写入内容。",
          };
    }

    if (/(完整图文|完整文章|一篇|初稿|生成.*正文|生成.*图文|写.*图文|写.*文章|直接生成|根据.*生成)/.test(input.message)) {
      return {
        action: "run_skill",
        skillKey: "content-production-line",
        confidence: 0.78,
        message: "正在生成完整图文，并会自动写入编辑器。",
        input: {
          theme: input.message,
        },
      };
    }

    if (text.includes("generate") && (text.includes("article") || text.includes("draft"))) {
      return {
        action: "run_skill",
        skillKey: "content-production-line",
        confidence: 0.72,
        message: "I will generate a complete draft from this request.",
        input: { theme: input.message },
      };
    }

    return { action: "chat", confidence: 0.6 };
  }

  private confidence(value: unknown) {
    const numeric = typeof value === "number" ? value : Number(value ?? 0.5);
    if (!Number.isFinite(numeric)) return 0.5;
    return Math.max(0, Math.min(1, numeric));
  }

  private summarize(value?: string) {
    const compact = value?.replace(/\s+/g, " ").trim() ?? "";
    return compact.length > 600 ? `${compact.slice(0, 600)}...` : compact;
  }
}
