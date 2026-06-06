# 内容安全审核输出结构

## 顶层结构

```ts
type SkillSafetyReviewResult = {
  audit: AuditResult;
  rewrite: ComplianceRewriteResult | null;
};
```

## AuditResult

```ts
type AuditResult = {
  passed: boolean;
  riskLevel: "low" | "medium" | "high";
  riskTypes: string[];
  reasons: string[];
  rewriteAvailable: boolean;
  riskItems: Array<{
    type: string;
    level: "low" | "medium" | "high";
    evidence: string;
    reason: string;
    start?: number;
    end?: number;
    confidence?: number;
    source?: "rule" | "llm" | "merged";
  }>;
  categoryScores: Record<string, number>;
};
```

## ComplianceRewriteResult

```ts
type ComplianceRewriteResult = {
  title: string;
  body: string;
  reasons: string[];
  replacements: Array<{
    original: string;
    replacement: string;
    reason: string;
    riskType?: string;
  }>;
};
```

## 输出原则

- `riskItems` 必须能支持前端展示风险片段。
- `reasons` 给用户看，应短而明确。
- `categoryScores` 用 0-1 分表示分类风险强度。
- `rewrite` 只有在审核失败且可改写时返回。
- 不要把审核解释写成 Markdown 长文。
