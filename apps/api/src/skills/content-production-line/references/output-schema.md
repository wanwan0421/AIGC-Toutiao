# DirectGenerateResult 输出结构

## 顶层结构

```ts
type DirectGenerateResult = {
  title: string;
  titleCandidates: Array<{ title: string; reason: string }>;
  bodyMarkdown: string;
  tags: string[];
  coverSuggestion?: string;
  imagePrompts: Array<{ position: string; prompt: string }>;
  outline: Array<{ heading: string; summary: string }>;
  coverAsset?: GeneratedImageAsset | null;
  imageAssets?: GeneratedImageAsset[];
};
```

## 字段要求

- `title`: 必填，非空字符串。
- `titleCandidates`: 数组，建议 3-6 个；候选标题不能全部与主标题相同。
- `bodyMarkdown`: 必填，非空字符串；第一行不要重复主标题。
- `tags`: 数组，建议 4-8 个；每个标签必须以 `#` 开头。
- `coverSuggestion`: 可选，但一键图文生成场景应尽量提供。
- `imagePrompts`: 数组；每项包含 `position` 和 `prompt`。
- `outline`: 数组；每项包含 `heading` 和 `summary`。
- `coverAsset`、`imageAssets`: 图片生成后由业务服务补充，草稿阶段可以为空。

## 校验原则

- 不允许返回 Markdown 包裹的 JSON。
- 不允许输出多段解释文本。
- 不允许将正文放入 `title` 或 `coverSuggestion`。
- 不允许把空数组字段省略。
