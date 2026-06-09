import type { DirectGenerateResult } from "@aicp/shared";

type ValidationResult = {
  ok: boolean;
  errors: string[];
  value: DirectGenerateResult;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function compactArray<T>(value: unknown, mapper: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.map(mapper).filter((item): item is T => Boolean(item));
}

function normalizeTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of value) {
    const tag = asText(raw).replace(/^#+/, "");
    if (!tag) continue;
    const next = `#${tag}`;
    if (seen.has(next)) continue;
    seen.add(next);
    normalized.push(next);
  }
  return normalized;
}

function stripRepeatedTitle(bodyMarkdown: unknown, title: unknown) {
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

export function validateDirectGenerateResult(input: unknown): ValidationResult {
  const record = asRecord(input);
  const errors: string[] = [];
  const value: DirectGenerateResult = {
    title: asText(record.title),
    titleCandidates: compactArray(record.titleCandidates, (item) => {
      const candidate = asRecord(item);
      const title = asText(candidate.title);
      if (!title) return null;
      return { title, reason: asText(candidate.reason) };
    }),
    bodyMarkdown: stripRepeatedTitle(record.bodyMarkdown, record.title),
    tags: normalizeTags(record.tags),
    coverSuggestion: asText(record.coverSuggestion),
    imagePrompts: compactArray(record.imagePrompts, (item) => {
      const imagePrompt = asRecord(item);
      const prompt = asText(imagePrompt.prompt);
      if (!prompt) return null;
      return {
        position: asText(imagePrompt.position) || "正文中",
        prompt,
      };
    }),
    outline: compactArray(record.outline, (item) => {
      const outlineItem = asRecord(item);
      const heading = asText(outlineItem.heading);
      const summary = asText(outlineItem.summary);
      if (!heading && !summary) return null;
      return { heading, summary };
    }),
    imageAssets: [],
  };

  if (!value.title) errors.push("title is required");
  if (!value.bodyMarkdown) errors.push("bodyMarkdown is required");
  if (!value.tags.length) errors.push("tags must contain at least one item");
  if (!Array.isArray(record.titleCandidates)) errors.push("titleCandidates must be an array");
  if (!Array.isArray(record.imagePrompts)) errors.push("imagePrompts must be an array");
  if (!Array.isArray(record.outline)) errors.push("outline must be an array");

  return {
    ok: errors.length === 0,
    errors,
    value,
  };
}
