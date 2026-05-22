import { AuditRiskLevel, type AiGenerateResult, type AuditResult, type QualityScoreResult } from "@aicp/shared";

export function makeGeneratedDraft(topic: string, style = "清爽、实用", materialNotes?: string): AiGenerateResult {
  const safeTopic = topic.trim() || "未命名选题";
  const materialLine = materialNotes ? `结合素材线索：${materialNotes}` : "结合已有素材与目标读者需求。";

  return {
    title: `${safeTopic}：一篇可以直接发布的短图文初稿`,
    body: `开头：围绕“${safeTopic}”给读者一个明确的问题场景，让内容从第一句话就有代入感。\n\n第一部分：用 ${style} 的表达方式交代核心观点，避免空泛描述。\n\n第二部分：拆成 3-5 个可执行步骤，每一步都给出具体做法和适用人群。\n\n第三部分：补充个人判断或避坑提醒，让内容不像模板堆砌。\n\n结尾：用一句行动建议收束，引导读者收藏、评论或尝试。\n\n${materialLine}`,
    tags: Array.from(new Set([safeTopic, "AI创作", "短图文"].map((tag) => tag.slice(0, 12)))),
    coverSuggestion: `封面建议突出“${safeTopic}”的核心视觉：主体清晰、背景干净，标题控制在 12 字以内。`
  };
}

export function buildAuditResult(title: string, body: string): AuditResult {
  const text = `${title}\n${body}`.toLowerCase();
  const riskWords = ["赌博", "博彩", "毒品", "色情", "隐私", "身份证", "低俗"];
  const hits = riskWords.filter((word) => text.includes(word.toLowerCase()));

  if (hits.length === 0) {
    return {
      passed: true,
      riskLevel: AuditRiskLevel.Low,
      riskTypes: ["none"],
      reasons: ["未发现高危合规风险。"],
      rewriteAvailable: false
    };
  }

  return {
    passed: false,
    riskLevel: hits.length > 1 ? AuditRiskLevel.High : AuditRiskLevel.Medium,
    riskTypes: hits.includes("隐私") || hits.includes("身份证") ? ["privacy"] : ["sensitive"],
    reasons: [`检测到可能违规或敏感表达：${hits.join("、")}。`],
    rewriteAvailable: true
  };
}

export function buildQualityScore(title: string, body: string): QualityScoreResult {
  const bodyLength = body.replace(/\s/g, "").length;
  const structure = body.includes("\n") ? 18 : 14;
  const clarity = Math.min(20, Math.max(12, Math.round(bodyLength / 60)));
  const value = body.includes("步骤") || body.includes("建议") || body.includes("提醒") ? 18 : 15;
  const attraction = title.length >= 8 && title.length <= 32 ? 18 : 14;
  const compliance = buildAuditResult(title, body).passed ? 19 : 10;
  const total = structure + clarity + value + attraction + compliance;

  return {
    total,
    dimensions: {
      structure,
      clarity,
      value,
      attraction,
      compliance
    },
    reason: total >= 85 ? "结构完整、表达清晰，适合进入审核发布流程。" : "内容可用，但建议继续补充结构、细节或合规表达。"
  };
}
