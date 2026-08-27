import "reflect-metadata";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { AiCallLogService } from "../modules/ai/ai-call-log.service";
import { ContentSafetyUseCase } from "../modules/ai/application/content-safety.use-case";

type RiskLevel = "low" | "medium" | "high";
type EvalSample = {
  id: string;
  title: string;
  body: string;
  expectedRiskLevel: RiskLevel;
  expectedHighRisk: boolean;
  category?: string;
  rationale?: string;
};

type EvalResult = EvalSample & {
  ok: boolean;
  elapsedMs: number;
  attempt: number;
  predictedRiskLevel?: RiskLevel;
  predictedHighRisk?: boolean;
  predictedRiskTypes?: string[];
  predictedRiskItemCount?: number;
  audit?: unknown;
  rewrite?: unknown;
  checkedAt?: string;
  error?: string;
};

const threshold = Number(process.argv[2] ?? 0.9);
const evaluationDir = firstExisting([
  resolve(process.cwd(), "docs/evaluation"),
  resolve(process.cwd(), "../../docs/evaluation"),
]);
const samplesPath = resolve(evaluationDir, "high-risk-eval-samples.json");
const baselinePath = resolve(evaluationDir, "high-risk-eval-full-llm-metrics.json");
const resultsPath = resolve(evaluationDir, "high-risk-eval-current-full-llm-results.json");
const metricsPath = resolve(evaluationDir, "high-risk-eval-current-full-llm-metrics.json");
const samplesRaw = readFileSync(samplesPath, "utf8");
const samples = JSON.parse(samplesRaw) as EvalSample[];
const datasetSha256 = createHash("sha256").update(samplesRaw).digest("hex");

if (!Array.isArray(samples)) throw new Error("high-risk eval samples must be an array");

async function main() {
  const startedAt = new Date();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  const callLogs = app.get(AiCallLogService);
  (callLogs as unknown as { log: (...args: unknown[]) => Promise<undefined> }).log = async () => undefined;
  const contentSafety = app.get(ContentSafetyUseCase);
  const results: EvalResult[] = [];

  try {
    for (const [index, sample] of samples.entries()) {
      const result = await evaluateSample(contentSafety, sample);
      results.push(result);
      const current = buildReport(results, startedAt);
      writeFileSync(resultsPath, `${JSON.stringify({ ...current, results }, null, 2)}\n`, "utf8");
      process.stdout.write(
        `[${index + 1}/${samples.length}] ${sample.id} expected=${sample.expectedRiskLevel} predicted=${result.predictedRiskLevel ?? "error"} ${result.elapsedMs}ms\n`
      );
    }
  } finally {
    await app.close();
  }

  const report = buildReport(results, startedAt);
  writeFileSync(resultsPath, `${JSON.stringify({ ...report, results }, null, 2)}\n`, "utf8");
  writeFileSync(metricsPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

async function evaluateSample(contentSafety: ContentSafetyUseCase, sample: EvalSample): Promise<EvalResult> {
  const maxAttempts = 2;
  const timeoutMs = positiveInt(process.env.SAFETY_EVAL_SAMPLE_TIMEOUT_MS, 120_000);
  const startedAt = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`evaluation sample timed out after ${timeoutMs}ms`)), timeoutMs);
    try {
      const audit = await contentSafety.review(
        { title: sample.title, body: sample.body },
        { signal: controller.signal }
      );
      return {
        ...sample,
        ok: true,
        elapsedMs: Date.now() - startedAt,
        attempt,
        predictedRiskLevel: audit.riskLevel,
        predictedHighRisk: audit.riskLevel === "high",
        predictedRiskTypes: audit.riskTypes,
        predictedRiskItemCount: audit.riskItems.length,
        audit,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    ...sample,
    ok: false,
    elapsedMs: Date.now() - startedAt,
    attempt: maxAttempts,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  };
}

function buildReport(results: EvalResult[], startedAt: Date) {
  const completed = results.filter((item) => item.ok && item.predictedRiskLevel);
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  const missed: string[] = [];
  const falseAlarms: string[] = [];
  const levels: RiskLevel[] = ["low", "medium", "high"];
  const riskLevelMatrix = Object.fromEntries(levels.map((expected) => [
    expected,
    Object.fromEntries(levels.map((predicted) => [predicted, 0])),
  ])) as Record<RiskLevel, Record<RiskLevel, number>>;

  for (const result of completed) {
    const expectedHigh = result.expectedRiskLevel === "high";
    const predictedHigh = result.predictedRiskLevel === "high";
    riskLevelMatrix[result.expectedRiskLevel][result.predictedRiskLevel!] += 1;
    if (expectedHigh && predictedHigh) tp += 1;
    else if (!expectedHigh && predictedHigh) {
      fp += 1;
      falseAlarms.push(result.id);
    } else if (expectedHigh) {
      fn += 1;
      missed.push(result.id);
    } else tn += 1;
  }

  const recall = ratio(tp, tp + fn);
  const precision = ratio(tp, tp + fp);
  const f1 = ratio(2 * precision * recall, precision + recall);
  const specificity = ratio(tn, tn + fp);
  const falsePositiveRate = ratio(fp, fp + tn);
  const falseNegativeRate = ratio(fn, fn + tp);
  const accuracy = ratio(tp + tn, tp + tn + fp + fn);
  const balancedAccuracy = (recall + specificity) / 2;
  const exactRiskLevelAccuracy = ratio(
    levels.reduce((sum, level) => sum + riskLevelMatrix[level][level], 0),
    completed.length
  );
  const latencies = completed.map((item) => item.elapsedMs).sort((a, b) => a - b);
  const baseline = readJsonIfExists(baselinePath) as { metrics?: Record<string, number> } | null;
  const currentMetrics = { accuracy, highRiskRecall: recall, highRiskPrecision: precision, f1, specificity, falsePositiveRate, falseNegativeRate, balancedAccuracy, exactRiskLevelAccuracy };

  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      startedAt: startedAt.toISOString(),
      mode: "Nest application context: ContentSafetyUseCase.review (rule scan -> LLM review -> result merge; rewrite excluded because it does not affect classification)",
      datasetPath: samplesPath,
      datasetSha256,
      threshold,
      callLogPersistenceDisabled: true,
      callLogPersistenceReason: "Evaluation must not fail when the local AiCallLog usage migration has not been applied.",
    },
    totalSamples: samples.length,
    evaluatedSoFar: results.length,
    completed: completed.length,
    failed: results.length - completed.length,
    confusionMatrix: { tp, fp, tn, fn },
    riskLevelConfusionMatrix: riskLevelMatrix,
    metrics: currentMetrics,
    latencyMs: {
      average: ratio(latencies.reduce((sum, value) => sum + value, 0), latencies.length),
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: latencies.at(-1) ?? 0,
    },
    passed: results.length === samples.length && completed.length === samples.length && recall >= threshold,
    missedHighRiskSampleIds: missed,
    falseAlarmSampleIds: falseAlarms,
    failedSampleIds: results.filter((item) => !item.ok).map((item) => item.id),
    categoryBreakdown: categoryBreakdown(completed),
    previousBaseline: baseline?.metrics ? {
      metrics: baseline.metrics,
      delta: Object.fromEntries(Object.entries(currentMetrics).flatMap(([key, value]) =>
        typeof baseline.metrics?.[key] === "number" ? [[key, value - baseline.metrics[key]]] : []
      )),
    } : null,
  };
}

function categoryBreakdown(results: EvalResult[]) {
  const categories = new Map<string, EvalResult[]>();
  for (const result of results) {
    const category = result.category ?? "unknown";
    categories.set(category, [...(categories.get(category) ?? []), result]);
  }
  return Object.fromEntries([...categories.entries()].map(([category, items]) => {
    const expectedHigh = items.filter((item) => item.expectedRiskLevel === "high");
    const predictedHigh = items.filter((item) => item.predictedRiskLevel === "high");
    const trueHigh = expectedHigh.filter((item) => item.predictedRiskLevel === "high");
    return [category, {
      total: items.length,
      expectedHigh: expectedHigh.length,
      predictedHigh: predictedHigh.length,
      highRiskRecall: ratio(trueHigh.length, expectedHigh.length),
      highRiskPrecision: ratio(trueHigh.length, predictedHigh.length),
      errors: items.filter((item) => item.expectedRiskLevel !== item.predictedRiskLevel).map((item) => item.id),
    }];
  }));
}

function ratio(numerator: number, denominator: number) {
  return denominator ? numerator / denominator : 0;
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function percentile(values: number[], quantile: number) {
  if (!values.length) return 0;
  return values[Math.min(values.length - 1, Math.ceil(values.length * quantile) - 1)];
}

function firstExisting(paths: string[]) {
  const found = paths.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`evaluation directory not found: ${paths.join(", ")}`);
  return found;
}

function readJsonIfExists(path: string) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as unknown : null;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
