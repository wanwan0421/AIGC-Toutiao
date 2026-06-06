#!/usr/bin/env node

const fs = require("node:fs");

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

function validateDirectGenerateResult(input) {
  const errors = [];
  const value = {
    title: asText(input && input.title),
    titleCandidates: compactArray(input && input.titleCandidates, (item) => {
      const title = asText(item && item.title);
      if (!title) return null;
      return { title, reason: asText(item && item.reason) };
    }),
    bodyMarkdown: stripRepeatedTitle(input && input.bodyMarkdown, input && input.title),
    tags: normalizeTags(input && input.tags),
    coverSuggestion: asText(input && input.coverSuggestion),
    imagePrompts: compactArray(input && input.imagePrompts, (item) => {
      const prompt = asText(item && item.prompt);
      if (!prompt) return null;
      return { position: asText(item && item.position) || "正文中", prompt };
    }),
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

  return {
    ok: errors.length === 0,
    errors,
    value,
  };
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
