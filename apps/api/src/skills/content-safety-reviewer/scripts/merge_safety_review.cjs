#!/usr/bin/env node

const fs = require("node:fs");

const LEVEL_SCORE = {
  low: 1,
  medium: 2,
  high: 3,
};

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLevel(value) {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function normalizeConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.5;
  return Math.max(0, Math.min(1, numeric));
}

function normalizeRiskItem(item, source) {
  const evidence = asText(item && item.evidence);
  const type = asText(item && item.type) || "unknown";
  if (!evidence || !type) return null;
  return {
    type,
    level: normalizeLevel(item && item.level),
    evidence,
    reason: asText(item && item.reason) || "命中内容安全风险",
    start: Number.isFinite(Number(item && item.start)) ? Number(item.start) : undefined,
    end: Number.isFinite(Number(item && item.end)) ? Number(item.end) : undefined,
    confidence: normalizeConfidence(item && item.confidence),
    source,
  };
}

function keyOf(item) {
  return `${item.type}:${item.evidence}`;
}

function mergeRiskItems(ruleItems, llmRiskItems) {
  const byKey = new Map();
  for (const item of [
    ...(Array.isArray(ruleItems) ? ruleItems.map((value) => normalizeRiskItem(value, "rule")) : []),
    ...(Array.isArray(llmRiskItems) ? llmRiskItems.map((value) => normalizeRiskItem(value, "llm")) : []),
  ]) {
    if (!item) continue;
    const key = keyOf(item);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }
    byKey.set(key, {
      ...existing,
      level: LEVEL_SCORE[item.level] > LEVEL_SCORE[existing.level] ? item.level : existing.level,
      confidence: Math.max(existing.confidence, item.confidence),
      reason: existing.reason === item.reason ? existing.reason : `${existing.reason}; ${item.reason}`,
      source: "merged",
    });
  }
  return Array.from(byKey.values()).sort((a, b) => LEVEL_SCORE[b.level] - LEVEL_SCORE[a.level]);
}

function riskLevelOf(items) {
  if (items.some((item) => item.level === "high" && item.confidence >= 0.55)) return "high";
  if (items.some((item) => item.level === "medium" && item.confidence >= 0.55)) return "medium";
  if (items.length) return "low";
  return "low";
}

function categoryScoresOf(items) {
  const scores = {};
  for (const item of items) {
    const base = item.level === "high" ? 1 : item.level === "medium" ? 0.7 : 0.35;
    scores[item.type] = Math.max(scores[item.type] || 0, Number((base * item.confidence).toFixed(2)));
  }
  return scores;
}

function mergeSafetyReview(input) {
  const llmRiskItems = Array.isArray(input && input.llmRiskItems)
    ? input.llmRiskItems
    : Array.isArray(input && input.riskItems)
      ? input.riskItems
      : [];
  const riskItems = mergeRiskItems(input && input.ruleItems, llmRiskItems);
  const riskLevel = riskLevelOf(riskItems);
  const passed = riskItems.every((item) => item.level === "low" || item.confidence < 0.55);
  const riskTypes = Array.from(new Set(riskItems.map((item) => item.type)));
  const reasons = riskItems.slice(0, 5).map((item) => item.reason);

  return {
    audit: {
      passed,
      riskLevel,
      riskTypes,
      reasons,
      rewriteAvailable: !passed,
      riskItems,
      categoryScores: categoryScoresOf(riskItems),
    },
    rewrite: input && input.rewrite ? input.rewrite : null,
  };
}

function readJsonFromArg(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function selfTest() {
  const result = mergeSafetyReview({
    ruleItems: [
      {
        type: "privacy",
        level: "medium",
        evidence: "13800000000",
        reason: "疑似手机号",
        confidence: 0.9,
      },
    ],
    llmRiskItems: [
      {
        type: "privacy",
        level: "medium",
        evidence: "13800000000",
        reason: "泄露联系方式",
        confidence: 0.8,
      },
    ],
  });
  if (result.audit.passed) throw new Error("medium privacy risk should not pass");
  if (result.audit.riskItems.length !== 1) throw new Error("duplicate risk item was not merged");
  return result;
}

function main() {
  const arg = process.argv[2];
  if (arg === "--self-test") {
    process.stdout.write(`${JSON.stringify(selfTest(), null, 2)}\n`);
    return;
  }
  if (!arg) {
    process.stderr.write("Usage: node merge_safety_review.cjs <review-input.json>\n");
    process.stderr.write("       node merge_safety_review.cjs --self-test\n");
    process.exitCode = 2;
    return;
  }
  const result = mergeSafetyReview(readJsonFromArg(arg));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  mergeSafetyReview,
  mergeRiskItems,
};
