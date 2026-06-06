---
name: content-safety-reviewer
description: 内容安全审核技能。当用户需要判断图文是否可以发布、是否存在色情、赌博、毒品、敏感、低俗、隐私、违法、诈骗、未成年人或其他合规风险时使用。技能结合规则词库、正则规则、LLM 语义复核、结果合并和合规改写建议。
---

# 内容安全审核技能

判断当前图文是否可以发布，并在失败时提供可替换的合规改写建议。这个 Skill 是“规则 + 语义 + 合并 + 改写”的审核流程，不是单个审核 Prompt。

> 风险类型和输出结构见 `references/`，语义审核和改写提示词见 `prompts/`，确定性合并参考脚本见 `scripts/merge_safety_review.cjs`。

---

## 执行场景

使用这个 Skill：

- 用户点击“内容审核”。
- 用户在右侧 AI 交互中心说“审核当前内容”“看看能不能发”“有没有违规风险”“帮我做合规检查”。
- 平台后台需要对已保存内容执行审核任务。

不要使用这个 Skill：

- 用户只想优化表达质量，使用质量评估或写作建议。
- 用户只想生成标题或正文，使用创作生产线或普通 Prompt。

---

## 工作流程

### Step 1：读取审核输入

输入必须包含：

- `title`：标题。
- `body`：正文。

如果标题和正文都为空，先要求用户提供内容，不要返回通过。

### Step 2：规则预检

使用平台规则词库和正则规则扫描显性风险。

输出规则候选项：

- 风险类型。
- 命中证据。
- 字段位置。
- 置信度。
- 建议处理方式。

### Step 3：LLM 语义复核

参考 `prompts/01-semantic-risk-review.md`。

LLM 必须：

- 复核规则命中的片段，降低误杀。
- 补充规则未命中的语义风险。
- 输出结构化 `riskItems`。
- 不做质量评分。
- 不做改写。

### Step 4：合并审核结果

参考 `scripts/merge_safety_review.cjs` 和 `references/output-schema.md`。

合并规则：

- 中高风险项会影响 `passed`。
- 同一片段的规则风险和 LLM 风险要合并。
- LLM 明确否定且置信度低的规则命中可降级。
- 保留可解释证据，方便前端展示风险片段。

### Step 5：合规改写

如果审核不通过且 `rewriteAvailable = true`，参考 `prompts/02-compliance-rewrite.md` 生成改写建议。

改写必须：

- 保留原主题和有效信息。
- 删除、弱化或替换风险表达。
- 不新增未经用户提供的事实。
- 尽量返回 `replacements`，用于前端逐条替换风险片段。

---

## 输出

返回：

```json
{
  "audit": {
    "passed": false,
    "riskLevel": "medium",
    "riskTypes": ["privacy"],
    "reasons": ["存在隐私泄露风险"],
    "rewriteAvailable": true,
    "riskItems": [],
    "categoryScores": {}
  },
  "rewrite": {
    "title": "合规标题",
    "body": "合规正文",
    "reasons": ["移除隐私信息"],
    "replacements": []
  }
}
```

---

## 技能资源

### 阶段提示词

- `prompts/01-semantic-risk-review.md`：LLM 语义审核。
- `prompts/02-compliance-rewrite.md`：合规改写。

### 参考文档

- `references/risk-taxonomy.md`：风险类型、等级和判定边界。
- `references/output-schema.md`：审核与改写输出结构。
- `references/rule-engine-contract.md`：规则引擎输入输出约定。

### 静态资源

当前 Skill 不依赖输出型静态素材；平台敏感词库和正则规则由业务规则服务提供，作为 Step 2 的工具输入。

### 脚本

- `scripts/merge_safety_review.cjs`：合并规则结果和 LLM 审核结果的确定性参考实现。
