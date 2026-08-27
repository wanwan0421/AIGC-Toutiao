import { Injectable, Logger } from "@nestjs/common";
import { ModelClientService } from "../model-client.service";
import { completeStructured } from "../structured-output";
import { skillRouterSchema } from "./structured-agent.schemas";
import { SkillRegistryService } from "../skills-runtime/skill-registry.service";
import type { SkillRouterDecision } from "../skills-runtime/skill-runtime.types";

type RouterInput = {
  message: string;
  currentTitle?: string;
  currentBody?: string;
  selectedText?: string;
  historyText?: string;
};

const ROUTER_UNAVAILABLE_MESSAGE =
  "暂时无法可靠判断应该调用哪个技能，请稍后重试，或直接使用页面上的对应功能按钮。";

@Injectable()
export class SkillRouterAgent {
  private readonly logger = new Logger(SkillRouterAgent.name);

  constructor(
    private readonly modelClient: ModelClientService,
    private readonly registry: SkillRegistryService
  ) {}

  async decide(input: RouterInput, options: { signal?: AbortSignal; aiJobId?: string; contentId?: string; conversationId?: string } = {}): Promise<SkillRouterDecision> {
    if (!this.modelClient.hasRemoteProvider()) {
      return this.routeUnavailableDecision();
    }

    try {
      const structured = await completeStructured({
        modelClient: this.modelClient, name: "skill_router", schema: skillRouterSchema,
        telemetry: {
          scene: "skill_router",
          inputSummary: input.message.slice(0, 160),
          aiJobId: options.aiJobId,
          contentId: options.contentId,
          conversationId: options.conversationId,
        },
        apiStyle: this.apiStyle(),
        cacheStrategy: this.cacheEnabled() ? "prefix" : "off",
        store: false,
        temperature: 0.05,
        thinking: "disabled",
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
        signal: options.signal,
      });
      const parsed: Partial<SkillRouterDecision> = {
        ...structured,
        skillKey: structured.skillKey ?? undefined,
        message: structured.message ?? undefined,
        input: Object.fromEntries(Object.entries(structured.input).filter(([, value]) => value !== null)),
      };
      return this.normalize(parsed) ?? this.routeUnavailableDecision();
    } catch (error) {
      this.logger.debug(`Skill router unavailable: ${(error as Error).message}`);
      return this.routeUnavailableDecision();
    }
  }

  private apiStyle() {
    return process.env.AI_SKILL_ROUTER_API_STYLE?.trim().toLowerCase() === "chat_completions"
      ? "chat_completions" as const
      : "responses" as const;
  }

  private cacheEnabled() {
    return process.env.AI_SKILL_ROUTER_CACHE_ENABLED?.trim().toLowerCase() !== "false";
  }

  private systemPrompt() {
    const skills = this.registry.listForRouter();
    const skillKeys = skills.map((skill) => skill.key).join("|") || "无";

    return [
      "你是中文 AI 内容创作平台的 Skill Router。",
      "你只能基于用户输入、当前内容状态，以及下方技能的 key/name/description 判断是否需要调用一个技能。",
      "路由阶段只能看到技能 key/name/description，不要臆测未列出的技能能力。",
      "只返回可解析 JSON，不要解释推理过程。",
      "",
      "可用技能（路由阶段仅提供 key/name/description）：",
      JSON.stringify(skills, null, 2),
      "",
      "可选 action：",
      "- chat：普通对话、思路碰撞、标题建议、解释说明，或不需要启动后台技能的写作辅助。",
      "- edit_current_content：局部编辑当前文章，例如扩写、改写、润色、补充某段或选中文本。",
      "- ask_clarification：用户明显想调用技能但缺少必要输入，或你无法可靠判断要调用哪个技能。",
      "- run_skill：仅在某个技能 description 与用户意图明确匹配时使用，且一次只选择一个 skillKey。",
      "",
      "选择规则：",
      "- 不要用关键词命中来替代语义判断；必须结合技能 description 和当前上下文。",
      "- 用户只要求局部段落或选中文本改写时，使用 edit_current_content，不要启动完整图文生成。",
      "- 用户只是聊天、咨询、头脑风暴、标题候选或解释说明时，使用 chat。",
      "- 用户明确要求完整技能但缺少当前内容或必要素材时，使用 ask_clarification，并给出一个简短中文问题。",
      "- run_skill 的 skillKey 必须来自可用技能列表；禁止输出未列出的 skillKey。",
      "",
      "返回 JSON 结构：",
      `{"action":"chat|run_skill|edit_current_content|ask_clarification","skillKey":"${skillKeys}","confidence":0.9,"message":"简短中文状态或问题","input":{}}`,
    ].join("\n");
  }

  private userPrompt(input: RouterInput) {
    const currentBodySummary = this.summarize(input.currentBody);
    return JSON.stringify(
      {
        message: input.message,
        currentTitle: input.currentTitle ?? "",
        currentBodySummary,
        hasCurrentContent: Boolean(input.currentTitle?.trim() || currentBodySummary),
        selectedText: input.selectedText ?? "",
        hasSelectedText: Boolean(input.selectedText?.trim()),
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
    if (value.action === "edit_current_content") {
      return {
        action: "edit_current_content",
        confidence: this.confidence(value.confidence),
        message: value.message,
        input: this.recordInput(value.input),
      };
    }
    if (value.action === "ask_clarification") {
      return {
        action: "ask_clarification",
        confidence: this.confidence(value.confidence),
        message: value.message ?? "我还需要更多信息才能继续。",
      };
    }
    if (value.action === "run_skill" && this.registry.isKnownSkillKey(value.skillKey)) {
      return {
        action: "run_skill",
        skillKey: value.skillKey,
        confidence: this.confidence(value.confidence),
        message: value.message,
        input: this.recordInput(value.input),
      };
    }
    return null;
  }

  private routeUnavailableDecision(): SkillRouterDecision {
    return {
      action: "ask_clarification",
      confidence: 0,
      message: ROUTER_UNAVAILABLE_MESSAGE,
    };
  }

  private recordInput(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
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
