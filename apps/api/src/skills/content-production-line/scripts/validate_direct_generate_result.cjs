#!/usr/bin/env node

const fs = require("node:fs");
const { ARTICLE_TITLE_MAX_LENGTH, ARTICLE_BODY_MAX_LENGTH, countArticleCharacters } = require("@aicp/shared");

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  const normalized = [];
  for (const raw of tags) {
    const tag = asText(raw).replace(/^#+/, "");
    if (!tag) continue;
    const value = `#${tag}`;
    if (seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

function compactArray(value, mapper) {
  if (!Array.isArray(value)) return [];
  return value.map(mapper).filter(Boolean);
}

function stripRepeatedTitle(bodyMarkdown, title) {
  const body = asText(bodyMarkdown);
  const cleanTitle = asText(title).replace(/^#+\s*/, "");
  if (!body || !cleanTitle) return body;
  const lines = body.split(/\r?\n/);
  const first = asText(lines[0]).replace(/^#+\s*/, "");
  if (first === cleanTitle) {
    return lines.slice(1).join("\n").trim();
  }
  return body;
}

function normalizeSlotId(value, index, used) {
  const fallback = `slot_${index + 1}`;
  const raw = asText(value) || fallback;
  const base = raw.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || fallback;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function imageSlotMarker(slotId) {
  return `<!-- aicp-image-slot:${slotId} -->`;
}

function ensureImageSlotMarkers(bodyMarkdown, slotIds) {
  if (!bodyMarkdown || !slotIds.length) return bodyMarkdown;
  const existing = new Set(Array.from(bodyMarkdown.matchAll(/<!--\s*aicp-image-slot:([a-zA-Z0-9_-]+)\s*-->/g)).map((match) => match[1]));
  const missing = slotIds.filter((slotId) => !existing.has(slotId));
  if (!missing.length) return bodyMarkdown;

  const blocks = bodyMarkdown.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  if (!blocks.length) return bodyMarkdown;

  const inserts = new Map();
  missing.forEach((slotId, index) => {
    const afterBlock = Math.max(1, Math.min(blocks.length, Math.round(((index + 1) / (missing.length + 1)) * blocks.length)));
    inserts.set(afterBlock, [...(inserts.get(afterBlock) || []), imageSlotMarker(slotId)]);
  });

  const output = [];
  blocks.forEach((block, index) => {
    output.push(block);
    output.push(...(inserts.get(index + 1) || []));
  });
  return output.join("\n\n");
}

function validateDirectGenerateResult(input) {
  const errors = [];
  const usedSlotIds = new Set();
  const imagePrompts = compactArray(input && input.imagePrompts, (item, index) => {
    const prompt = asText(item && item.prompt);
    if (!prompt) return null;
    const slotId = normalizeSlotId(item && item.slotId, index, usedSlotIds);
    return {
      position: asText(item && item.position) || "正文中",
      prompt,
      slotId,
    };
  });
  const bodyMarkdown = ensureImageSlotMarkers(stripRepeatedTitle(input && input.bodyMarkdown, input && input.title), imagePrompts.map((item) => item.slotId));
  const value = {
    title: asText(input && input.title),
    titleCandidates: compactArray(input && input.titleCandidates, (item) => {
      const title = asText(item && item.title);
      if (!title) return null;
      return { title, reason: asText(item && item.reason) };
    }),
    bodyMarkdown,
    tags: normalizeTags(input && input.tags),
    coverSuggestion: asText(input && input.coverSuggestion),
    imagePrompts,
    outline: compactArray(input && input.outline, (item) => {
      const heading = asText(item && item.heading);
      const summary = asText(item && item.summary);
      if (!heading && !summary) return null;
      return { heading, summary };
    }),
    coverAsset: input && Object.prototype.hasOwnProperty.call(input, "coverAsset") ? input.coverAsset : null,
    imageAssets: Array.isArray(input && input.imageAssets) ? input.imageAssets : [],
  };

  if (!value.title) errors.push("title is required");
  if (!value.bodyMarkdown) errors.push("bodyMarkdown is required");
  if (!value.tags.length) errors.push("tags must contain at least one item");
  if (!Array.isArray(input && input.titleCandidates)) errors.push("titleCandidates must be an array");
  if (!Array.isArray(input && input.imagePrompts)) errors.push("imagePrompts must be an array");
  if (!Array.isArray(input && input.outline)) errors.push("outline must be an array");
  const titleLength = countArticleCharacters(value.title);
  if (titleLength > ARTICLE_TITLE_MAX_LENGTH) errors.push(`title exceeds ${ARTICLE_TITLE_MAX_LENGTH} visible characters (${titleLength})`);
  value.titleCandidates.forEach((candidate, index) => {
    const length = countArticleCharacters(candidate.title);
    if (length > ARTICLE_TITLE_MAX_LENGTH) errors.push(`titleCandidates[${index}].title exceeds ${ARTICLE_TITLE_MAX_LENGTH} visible characters (${length})`);
  });
  const bodyLength = countArticleCharacters(visibleMarkdownText(value.bodyMarkdown));
  if (bodyLength > ARTICLE_BODY_MAX_LENGTH) errors.push(`bodyMarkdown visible text exceeds ${ARTICLE_BODY_MAX_LENGTH} characters (${bodyLength})`);

  return {
    ok: errors.length === 0,
    errors,
    value,
  };
}

function visibleMarkdownText(markdown) {
  // Mirror the editor's Markdown subset: every nonempty line becomes a block,
  // and TipTap getText() separates blocks with two line breaks.
  const lines = asText(markdown)
    .replace(/<!--\s*aicp-image-slot:[a-zA-Z0-9_-]+\s*-->/g, "")
    .split(/\r\n?|\n/);
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    const next = lines[index + 1]?.trim() ?? "";
    if (/^\|.*\|$/.test(line) && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(next)) {
      const tableLines = [line];
      index += 2;
      while (index < lines.length && /^\|.*\|$/.test(lines[index].trim())) {
        tableLines.push(lines[index].trim());
        index += 1;
      }
      index -= 1;
      blocks.push(tableLines.map((row) => row.replace(/^\||\|$/g, "").split("|").map((cell) => visibleInlineMarkdown(cell.trim())).join("\n\n")).join("\n\n"));
      continue;
    }
    const text = /^#{1,3}\s+/.test(line)
      ? line.replace(/^#{1,3}\s+/, "")
      : /^[-*]\s+/.test(line) ? line.replace(/^[-*]\s+/, "") : line;
    blocks.push(visibleInlineMarkdown(text));
  }
  return blocks.join("\n\n");
}

function visibleInlineMarkdown(text) {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`(.+?)`/g, "$1");
}

function readJsonFromArg(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function selfTest() {
  const result = validateDirectGenerateResult({
    title: "测试标题",
    titleCandidates: [{ title: "候选标题" }],
    bodyMarkdown: "# 测试标题\n\n正文内容",
    tags: ["测试", "#内容"],
    imagePrompts: [{ prompt: "横版封面" }],
    outline: [{ heading: "小节", summary: "说明" }],
  });
  if (!result.ok) {
    throw new Error(result.errors.join("; "));
  }
  if (result.value.bodyMarkdown.startsWith("# 测试标题")) {
    throw new Error("repeated title was not stripped");
  }
  const longTitle = validateDirectGenerateResult({ ...result.value, title: "标".repeat(ARTICLE_TITLE_MAX_LENGTH + 1) });
  if (longTitle.ok || !longTitle.errors.some((item) => item.includes("title exceeds"))) throw new Error("long title was accepted");
  const longBody = validateDirectGenerateResult({ ...result.value, bodyMarkdown: "文".repeat(ARTICLE_BODY_MAX_LENGTH + 1) });
  if (longBody.ok || !longBody.errors.some((item) => item.includes("bodyMarkdown visible text"))) throw new Error("long body was accepted");
  const exactBody = validateDirectGenerateResult({ ...result.value, bodyMarkdown: `${"文".repeat(498)}\n\n${"文".repeat(500)}` });
  if (!exactBody.ok) throw new Error("1000 visible characters were rejected");
  const paragraphHeavyBody = validateDirectGenerateResult({ ...result.value, bodyMarkdown: Array(335).fill("文").join("\n\n") });
  if (paragraphHeavyBody.ok) throw new Error("visible paragraph separators were not counted");
  return result;
}

function main() {
  const arg = process.argv[2];
  if (arg === "--self-test") {
    process.stdout.write(`${JSON.stringify(selfTest(), null, 2)}\n`);
    return;
  }
  if (!arg) {
    process.stderr.write("Usage: node validate_direct_generate_result.cjs <result.json>\n");
    process.stderr.write("       node validate_direct_generate_result.cjs --self-test\n");
    process.exitCode = 2;
    return;
  }
  const result = validateDirectGenerateResult(readJsonFromArg(arg));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
  main();
}

module.exports = {
  validateDirectGenerateResult,
};
