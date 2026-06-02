import { Injectable } from "@nestjs/common";
import type { ComplianceRewriteResult } from "@aicp/shared";
import { AiCallLogService } from "../ai-call-log.service";
import { ModelClientService } from "../model-client.service";
import { AI_PROMPT_NAMES } from "../prompt-names";
import { PromptTemplateService } from "../prompt-template.service";
import { parseJsonObject } from "../structured-output";

const COMPLIANCE_REWRITE_FALLBACK_PROMPT = `你是中文内容合规改写编辑，只负责生成可替换的合规版本。

原标题：{{title}}
原正文：{{body}}
审核原因：
{{reasons}}

请保留原主题和有价值信息，弱化或移除违规、敏感、夸大、隐私泄露和低俗表达。
只返回 JSON，不要输出 Markdown 或额外解释：
{
  "title": "合规改写后的标题",
  "body": "合规改写后的正文",
  "reasons": ["弱化绝对化表达", "移除敏感信息"]
}`;

@Injectable()
export class ComplianceRewriteAgent {
  constructor(
    private readonly modelClient: ModelClientService,
    private readonly prompts: PromptTemplateService,
    private readonly logs: AiCallLogService
  ) {}

  async run(input: { title: string; body: string; reasons?: string[] }): Promise<ComplianceRewriteResult> {
    const startedAt = Date.now();
    const variables = {
      ...input,
      reasons: input.reasons?.length ? input.reasons : ["根据安全审查结果生成合规替代表达"],
    };
    const { prompt, model } = await this.prompts.render(
      AI_PROMPT_NAMES.complianceRewrite,
      variables,
      COMPLIANCE_REWRITE_FALLBACK_PROMPT
    );

    try {
      const content = await this.modelClient.complete({
        model,
        temperature: 0.45,
        messages: [
          {
            role: "system",
            content: "你是严格的中文合规改写模型。只输出可解析 JSON，不输出推理过程。",
          },
          { role: "user", content: prompt },
        ],
      });
      const parsed = parseJsonObject<Partial<ComplianceRewriteResult>>(content);
      if (!parsed) {
        throw new Error("compliance_rewrite returned invalid JSON");
      }

      const result = this.normalize(input, parsed);
      await this.logs.log({
        scene: AI_PROMPT_NAMES.complianceRewrite,
        model: this.modelClient.modelName(model),
        inputSummary: `${input.title} / ${input.reasons?.join("; ") ?? ""}`,
        output: result,
        latencyMs: Date.now() - startedAt,
        success: true,
      });
      return result;
    } catch (error) {
      await this.logs.log({
        scene: AI_PROMPT_NAMES.complianceRewrite,
        model: this.modelClient.modelName(model),
        inputSummary: `${input.title} / ${input.reasons?.join("; ") ?? ""}`,
        latencyMs: Date.now() - startedAt,
        success: false,
        errorMessage: error instanceof Error ? error.message : "unknown compliance rewrite error",
      });
      throw error;
    }
  }

  private normalize(input: { title: string; body: string; reasons?: string[] }, value: Partial<ComplianceRewriteResult>) {
    return {
      title: value.title?.trim() || input.title,
      body: value.body?.trim() || input.body,
      reasons: this.normalizeStringArray(value.reasons, input.reasons ?? ["根据安全审查结果生成合规替代表达"]),
    };
  }

  private normalizeStringArray(value: unknown, fallback: string[]) {
    if (!Array.isArray(value)) return fallback;
    const list = value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
    return list.length ? list : fallback;
  }
}
