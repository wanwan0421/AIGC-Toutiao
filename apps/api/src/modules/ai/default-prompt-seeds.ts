import { PromptScene } from "@prisma/client";
import { AI_PROMPT_NAMES } from "./prompt-names";

export type DefaultPromptSeed = {
  key: string;
  scene: PromptScene;
  displayName: string;
  variables: string[];
  modelOptions: Record<string, unknown>;
  template: string;
};

export const DEFAULT_PROMPT_SEEDS: DefaultPromptSeed[] = [
  {
    key: AI_PROMPT_NAMES.directGenerate,
    scene: PromptScene.generate,
    displayName: "Direct Generate",
    variables: ["theme", "audience", "style", "viewpoint", "materialNotes"],
    modelOptions: { temperature: 0.75 },
    template: `你是中文图文内容生产助手。请根据用户需求生成适合信息流阅读的完整图文草稿。

主题：{{theme}}
目标人群：{{audience}}
风格：{{style}}
核心观点：{{viewpoint}}
素材参考：{{materialNotes}}

只返回 JSON，不要输出 Markdown 代码块。字段必须包含 title、titleCandidates、bodyMarkdown、tags、coverSuggestion、imagePrompts、outline。`,
  },
  {
    key: AI_PROMPT_NAMES.creativeChat,
    scene: PromptScene.generate,
    displayName: "Creative Chat",
    variables: ["message", "currentTitle", "currentBody", "bodySummary", "selectedText", "historyText"],
    modelOptions: { temperature: 0.75 },
    template: `你是中文内容创作者的陪伴式写作助手，只负责碰撞思路、局部辅写和写作建议。

用户当前问题：{{message}}
当前标题：{{currentTitle}}
当前正文：{{currentBody}}
正文摘要：{{bodySummary}}
选中文本：{{selectedText}}
最近对话：{{historyText}}

优先回答用户这一轮问题。不要主动把局部问题改写成完整草稿生成任务。`,
  },
  {
    key: AI_PROMPT_NAMES.titleGenerate,
    scene: PromptScene.generate,
    displayName: "Title Generate",
    variables: ["currentTitle", "body"],
    modelOptions: { temperature: 0.65 },
    template: `你是中文信息流标题优化助手。请基于当前标题和正文生成标题候选。

当前标题：{{currentTitle}}
正文：{{body}}

只返回 JSON：{"candidates":[{"title":"标题","reason":"推荐理由"}]}`,
  },
  {
    key: AI_PROMPT_NAMES.selectionPolish,
    scene: PromptScene.rewrite,
    displayName: "Selection Polish",
    variables: ["selectedText", "surroundingContext", "tone"],
    modelOptions: { temperature: 0.45 },
    template: `请润色选中文本，让表达更顺、更清晰，但不要改变原意。

选中文本：{{selectedText}}
上下文：{{surroundingContext}}
目标语气：{{tone}}

只返回 JSON：{"replacement":"替换后的文本"}`,
  },
  {
    key: AI_PROMPT_NAMES.selectionExpand,
    scene: PromptScene.rewrite,
    displayName: "Selection Expand",
    variables: ["selectedText", "surroundingContext", "tone"],
    modelOptions: { temperature: 0.6 },
    template: `请扩写选中文本，补充具体场景、细节或可执行建议，并保持与上下文一致。

选中文本：{{selectedText}}
上下文：{{surroundingContext}}
目标语气：{{tone}}

只返回 JSON：{"replacement":"替换后的文本"}`,
  },
  {
    key: AI_PROMPT_NAMES.selectionTone,
    scene: PromptScene.rewrite,
    displayName: "Selection Tone",
    variables: ["selectedText", "surroundingContext", "tone"],
    modelOptions: { temperature: 0.55 },
    template: `请将选中文本改写为目标语气，保持信息准确，不新增未经提供的事实。

选中文本：{{selectedText}}
上下文：{{surroundingContext}}
目标语气：{{tone}}

只返回 JSON：{"replacement":"替换后的文本"}`,
  },
  {
    key: AI_PROMPT_NAMES.safetyReview,
    scene: PromptScene.audit,
    displayName: "Safety Review",
    variables: ["title", "body", "ruleRiskItemsJson"],
    modelOptions: { temperature: 0.15 },
    template: `你是严格的中文内容安全审核专家，只判断内容是否可以发布，不做质量评分，也不做改写。

标题：{{title}}
正文：{{body}}

规则引擎候选风险如下。它们可能有误杀，但你必须复核，并补充规则未命中的语义风险：
{{ruleRiskItemsJson}}

重点识别涉黄、涉赌、涉毒、敏感信息、站外引流、低俗表达、隐私泄露、违法交易、诈骗、未成年人风险和夸大绝对化表达。

只返回可解析 JSON，不要输出 Markdown 或额外解释。必须包含：
{
  "passed": false,
  "riskLevel": "high",
  "riskTypes": ["gambling"],
  "categoryScores": {
    "pornography": 0,
    "gambling": 0.92,
    "drug": 0,
    "sensitive": 0.2,
    "vulgar": 0,
    "privacy": 0,
    "illegal": 0,
    "fraud": 0,
    "minor": 0
  },
  "riskItems": [
    {
      "id": "llm_1",
      "type": "gambling",
      "severity": "high",
      "confidence": 0.92,
      "evidence": "从标题或正文中原样复制的风险片段",
      "reason": "为什么该片段不合规",
      "source": "llm",
      "field": "body",
      "suggestion": "删除或改写该风险表达"
    }
  ],
  "reasons": ["阻断原因摘要"],
  "rewriteAvailable": true
}

如果内容不安全，passed 必须为 false，riskLevel 必须为 medium 或 high，riskTypes 不能只包含 none，且每个明确风险片段都必须放入 riskItems。
如果没有明显合规风险，返回 passed true、riskLevel low、riskTypes ["none"]、riskItems []、categoryScores 接近 0、rewriteAvailable false。`,
  },
  {
    key: AI_PROMPT_NAMES.qualityScore,
    scene: PromptScene.score,
    displayName: "Quality Score",
    variables: ["title", "body"],
    modelOptions: { temperature: 0.25 },
    template: `你是中文图文内容质量评估专家，只负责多维质量评分，不做安全审核，也不做改写。

标题：{{title}}
正文：{{body}}

请从 structure、clarity、value、attraction、compliance 五个维度评分，每个维度 0-20，总分 0-100。只返回 JSON，字段包含 total、dimensions、reason。`,
  },
  {
    key: AI_PROMPT_NAMES.complianceRewrite,
    scene: PromptScene.rewrite,
    displayName: "Compliance Rewrite",
    variables: ["title", "body", "reasons", "riskItemsJson"],
    modelOptions: { temperature: 0.45 },
    template: `你是中文内容合规改写编辑，只负责生成可替换的合规版本。

原标题：{{title}}
原正文：{{body}}
审核原因：{{reasons}}
风险片段：{{riskItemsJson}}

请保留原主题和有价值信息，弱化或移除违规、敏感、夸大、隐私泄露和低俗表达。只返回 JSON，字段包含 title、body、reasons、replacements。replacement 必须是可直接插入正文的最终文本，不要写成操作建议。`,
  },
];
