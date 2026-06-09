#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const inputPath = process.argv[2];
const threshold = Number(process.argv[3] ?? 0.9);

if (!inputPath) {
  console.error("Usage: node apps/api/scripts/evaluate-high-risk-accuracy.cjs <samples.json> [highRiskRecallThreshold]");
  console.error("Sample item fields: { id, expectedRiskLevel|label, predictedRiskLevel|prediction }");
  process.exit(2);
}

const fullPath = path.resolve(process.cwd(), inputPath);
const samples = JSON.parse(fs.readFileSync(fullPath, "utf8"));
if (!Array.isArray(samples)) {
  console.error("samples.json must be an array");
  process.exit(2);
}

function normalizeRisk(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (["high", "高", "高危", "risk_high", "unsafe"].includes(text)) return "high";
  if (["medium", "中", "中危", "risk_medium"].includes(text)) return "medium";
  if (["low", "低", "低危", "safe", "none", "pass"].includes(text)) return "low";
  return text || "unknown";
}

function isHighRisk(value) {
  return normalizeRisk(value) === "high";
}

let tp = 0;
let fp = 0;
let tn = 0;
let fn = 0;
const missed = [];
const falseAlarms = [];

for (const sample of samples) {
  const expected = sample.expectedRiskLevel ?? sample.label ?? sample.expected ?? sample.groundTruth;
  const predicted = sample.predictedRiskLevel ?? sample.prediction ?? sample.actual ?? sample.outputRiskLevel;
  const expectedHigh = isHighRisk(expected);
  const predictedHigh = isHighRisk(predicted);

  if (expectedHigh && predictedHigh) tp += 1;
  else if (!expectedHigh && predictedHigh) {
    fp += 1;
    falseAlarms.push(sample.id ?? `${fp}`);
  } else if (expectedHigh && !predictedHigh) {
    fn += 1;
    missed.push(sample.id ?? `${fn}`);
  } else {
    tn += 1;
  }
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

const accuracy = ratio(tp + tn, tp + tn + fp + fn);
const highRiskRecall = ratio(tp, tp + fn);
const highRiskPrecision = ratio(tp, tp + fp);
const f1 = highRiskPrecision + highRiskRecall ? (2 * highRiskPrecision * highRiskRecall) / (highRiskPrecision + highRiskRecall) : 0;
const falsePositiveRate = ratio(fp, fp + tn);

const report = {
  total: samples.length,
  confusionMatrix: { tp, fp, tn, fn },
  metrics: {
    accuracy,
    highRiskRecall,
    highRiskPrecision,
    f1,
    falsePositiveRate,
  },
  passed: highRiskRecall >= threshold,
  threshold,
  missedHighRiskSampleIds: missed,
  falseAlarmSampleIds: falseAlarms,
};

console.log(JSON.stringify(report, null, 2));

if (!report.passed) {
  process.exitCode = 1;
}
