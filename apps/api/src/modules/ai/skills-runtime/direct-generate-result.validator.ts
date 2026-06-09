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

function compactArray<T>(value: unknown, mapper: (item: unknown, index: number) => T | null): T[] {
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

function normalizeSlotId(value: unknown, index: number, used: Set<string>) {
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

function imageSlotMarker(slotId: string) {
  return `<!-- aicp-image-slot:${slotId} -->`;
}

function ensureImageSlotMarkers(bodyMarkdown: string, slotIds: string[]) {
  if (!bodyMarkdown || !slotIds.length) return bodyMarkdown;
  const existing = new Set(
    Array.from(bodyMarkdown.matchAll(/<!--\s*aicp-image-slot:([a-zA-Z0-9_-]+)\s*-->/g)).map((match) => match[1])
  );
  const missing = slotIds.filter((slotId) => !existing.has(slotId));
  if (!missing.length) return bodyMarkdown;

  const blocks = bodyMarkdown.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  if (!blocks.length) return bodyMarkdown;

  const inserts = new Map<number, string[]>();
  missing.forEach((slotId, index) => {
    const afterBlock = Math.max(1, Math.min(blocks.length, Math.round(((index + 1) / (missing.length + 1)) * blocks.length)));
    inserts.set(afterBlock, [...(inserts.get(afterBlock) ?? []), imageSlotMarker(slotId)]);
  });

  const output: string[] = [];
  blocks.forEach((block, index) => {
    output.push(block);
    output.push(...(inserts.get(index + 1) ?? []));
  });
  return output.join("\n\n");
}

export function validateDirectGenerateResult(input: unknown): ValidationResult {
  const record = asRecord(input);
  const errors: string[] = [];
  const usedSlotIds = new Set<string>();
  const imagePrompts = compactArray(record.imagePrompts, (item, index) => {
    const imagePrompt = asRecord(item);
    const prompt = asText(imagePrompt.prompt);
    if (!prompt) return null;
    const slotId = normalizeSlotId(imagePrompt.slotId, index, usedSlotIds);
    return {
      position: asText(imagePrompt.position) || "正文中",
      prompt,
      slotId,
    };
  });
  const bodyMarkdown = ensureImageSlotMarkers(stripRepeatedTitle(record.bodyMarkdown, record.title), imagePrompts.map((item) => item.slotId));
  const value: DirectGenerateResult = {
    title: asText(record.title),
    titleCandidates: compactArray(record.titleCandidates, (item) => {
      const candidate = asRecord(item);
      const title = asText(candidate.title);
      if (!title) return null;
      return { title, reason: asText(candidate.reason) };
    }),
    bodyMarkdown,
    tags: normalizeTags(record.tags),
    coverSuggestion: asText(record.coverSuggestion),
    imagePrompts,
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
