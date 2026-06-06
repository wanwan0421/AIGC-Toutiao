---
name: content-production-line
description: 今日头条图文一键生产线。当用户需要根据主题、素材、历史对话或当前编辑内容生成完整图文初稿时使用。技能产出标题、正文、标签、封面建议、配图提示词和可写入编辑器的结构化结果；适用于左侧明确按钮触发和右侧对话 Agent 自动选择。
---

# 今日头条图文一键生产线

根据用户的主题、素材、创作简报、历史对话或当前编辑器内容，生产一篇可直接进入编辑器的今日头条图文初稿。这个 Skill 是完整生产线，不是单个标题或润色 Prompt。

> 阶段提示词见 `prompts/`，平台写作规范和输出结构见 `references/`，确定性校验脚本见 `scripts/validate_direct_generate_result.cjs`。

---

## 执行场景

使用这个 Skill：

- 用户点击左侧“AI 一键生成初稿”。
- 用户在右侧 AI 交互中心说“生成完整图文”“根据刚才讨论写一篇文章”“帮我直接产出标题正文封面建议”。
- 用户提供的是主题、素材、粗略想法或对话沉淀，需要转成完整发布包。

不要使用这个 Skill：

- 用户只要求生成标题，继续使用普通标题 Prompt。
- 用户只要求润色、扩写或调整语气，继续使用选区改写 Prompt。
- 用户要求审核能否发布，使用 `content-safety-reviewer`。

---

## 工作流程

### Step 1：需求分析

参考 `prompts/01-requirement-analyzer.md`。

提取并补齐：

- `theme`：核心主题或任务目标。
- `audience`：目标读者。
- `style`：表达风格。
- `viewpoint`：核心观点。
- `materialNotes`：素材、历史对话、当前正文中的可用信息。

如果来自右侧对话入口，优先使用用户本轮消息和最近对话；当前编辑器正文只作为素材，不要机械复述。

### Step 2：图文草稿写作

参考 `prompts/02-article-draft-writer.md` 和 `references/toutiao-style-guide.md`。

生成：

- 主标题。
- 3-6 个标题候选。
- 正文 Markdown。
- 标签。
- 大纲。

正文必须适合信息流阅读：短段落、强结构、具体可读、有信息增量。

### Step 3：视觉规划

参考 `prompts/03-visual-plan.md`。

生成：

- 封面建议。
- 正文配图提示词。
- 图片位置说明。

图片提示词要能被图像生成模型直接使用，避免只写“配一张好看的图”。

### Step 4：结构校验

参考 `references/output-schema.md` 和 `scripts/validate_direct_generate_result.cjs`。

校验：

- 必须包含 `title`、`bodyMarkdown`、`tags`。
- `titleCandidates` 是数组。
- `imagePrompts` 是数组。
- 标签统一带 `#`。
- 正文第一行不要重复标题。

### Step 5：图片生成与落库

调用平台图片生成能力生成封面和正文图片素材。

规则：

- 封面失败不阻断文字结果。
- 正文配图失败不阻断文字结果。
- 失败信息作为 warning 返回给前端。

---

## 输出

返回兼容平台的 `DirectGenerateResult`：

```json
{
  "title": "文章主标题",
  "titleCandidates": [{ "title": "候选标题", "reason": "推荐理由" }],
  "bodyMarkdown": "正文 Markdown",
  "tags": ["#标签"],
  "coverSuggestion": "封面图生成提示",
  "imagePrompts": [{ "position": "正文第 2 段后", "prompt": "图片生成提示" }],
  "outline": [{ "heading": "小节标题", "summary": "小节摘要" }],
  "coverAsset": null,
  "imageAssets": []
}
```

---

## 技能资源

### 阶段提示词

- `prompts/01-requirement-analyzer.md`：需求分析与素材整理。
- `prompts/02-article-draft-writer.md`：正文、标题、标签、大纲生成。
- `prompts/03-visual-plan.md`：封面建议与配图提示词生成。
- `prompts/04-output-normalizer.md`：输出结构修正。

### 参考文档

- `references/toutiao-style-guide.md`：今日头条信息流写作规范。
- `references/output-schema.md`：结构化输出字段和约束。
- `references/examples.md`：输入输出样例。

### 静态资源

- `assets/visual-style-presets.json`：封面和配图生成时可选的视觉风格预设。

### 脚本

- `scripts/validate_direct_generate_result.cjs`：校验和规范化 `DirectGenerateResult`。
