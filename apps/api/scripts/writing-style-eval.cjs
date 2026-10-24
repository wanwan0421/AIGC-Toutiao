#!/usr/bin/env node

// Stage 7 evaluation stays local: the blind cards and answer key contain author content.
const fs = require("node:fs");
const path = require("node:path");
const { randomInt, randomUUID, createHash } = require("node:crypto");

const TEXT_STAGES = new Set(["requirements", "article_draft", "visual_plan", "output_repair"]);
const RATING_FIELDS = ["styleSimilarity", "structureFit", "keyFactCoverage", "oldFactMisuse", "editMinutes", "editCharacters"];

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function comparableInput(value) {
  const input = { ...record(value) };
  for (const key of ["writingStyleSnapshot", "writingStyle", "expectedVersionId", "contentId", "conversationId", "assistantMessageId", "operationId"]) {
    delete input[key];
  }
  return input;
}

function validateCases(cases) {
  if (!Array.isArray(cases) || cases.length !== 20) throw new Error("Exactly 20 cases are required (10 travel, 10 graduate_life)");
  const ids = new Set();
  const counts = { travel: 0, graduate_life: 0 };
  const versions = {};
  for (const item of cases) {
    if (!item || typeof item.id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(item.id) || ids.has(item.id)) throw new Error("Case IDs must be unique ASCII identifiers");
    if (!(item.category in counts)) throw new Error(`Case ${item.id}: category must be travel or graduate_life`);
    if (typeof item.brief !== "string" || !item.brief.trim()) throw new Error(`Case ${item.id}: brief is required`);
    if (typeof item.noStyleJobId !== "string" || typeof item.styleJobId !== "string" || item.noStyleJobId === item.styleJobId) throw new Error(`Case ${item.id}: two distinct job IDs are required`);
    if (typeof item.styleVersionId !== "string" || !item.styleVersionId || typeof item.topicKey !== "string" || !item.topicKey) throw new Error(`Case ${item.id}: fixed styleVersionId and topicKey are required`);
    const versionKey = `${item.topicKey}:${item.styleVersionId}`;
    if (versions[item.category] && versions[item.category] !== versionKey) throw new Error(`Case ${item.id}: category must use one fixed topic style version`);
    versions[item.category] = versionKey;
    ids.add(item.id);
    counts[item.category] += 1;
  }
  if (counts.travel !== 10 || counts.graduate_life !== 10) throw new Error("Cases must contain 10 travel and 10 graduate_life tasks");
}

function validatePair(item, noStyle, styled, logsByJob) {
  for (const job of [noStyle, styled]) {
    if (!job || job.type !== "creative_direct_generate" || job.status !== "succeeded") throw new Error(`Case ${item.id}: both jobs must be successful direct-generation jobs`);
    if (!record(job.result).title || !record(job.result).bodyMarkdown) throw new Error(`Case ${item.id}: a job is missing generated title or body`);
  }
  if (noStyle.userId !== styled.userId) throw new Error(`Case ${item.id}: jobs belong to different authors`);
  if (!noStyle.contentId || !styled.contentId || noStyle.contentId === styled.contentId) throw new Error(`Case ${item.id}: variants need separate committed articles`);
  if (record(noStyle.input).writingStyleSnapshot !== undefined) throw new Error(`Case ${item.id}: baseline job used a writing style`);
  const snapshot = record(record(styled.input).writingStyleSnapshot);
  if (snapshot.mode !== "topic" || !snapshot.versionId || !snapshot.topicKey) throw new Error(`Case ${item.id}: styled job must use a fixed topic style version`);
  if (item.styleVersionId && snapshot.versionId !== item.styleVersionId) throw new Error(`Case ${item.id}: style version differs from the planned version`);
  if (item.topicKey && snapshot.topicKey !== item.topicKey) throw new Error(`Case ${item.id}: topic key differs from the planned topic`);
  if (hash(comparableInput(noStyle.input)) !== hash(comparableInput(styled.input))) throw new Error(`Case ${item.id}: request or frozen materials differ between variants`);

  const baselineLogs = logsByJob[noStyle.id] ?? [];
  const styledLogs = logsByJob[styled.id] ?? [];
  for (const stage of ["requirements", "article_draft", "visual_plan"]) {
    const a = baselineLogs.find((log) => log.stage === stage && log.success);
    const b = styledLogs.find((log) => log.stage === stage && log.success);
    if (!a || !b) throw new Error(`Case ${item.id}: missing successful telemetry for ${stage}`);
    for (const key of ["model", "promptKey", "promptVersionId", "thinkingMode", "apiStyle"]) {
      if (a[key] !== b[key]) throw new Error(`Case ${item.id}: ${stage} ${key} differs`);
    }
  }
  return { versionId: snapshot.versionId, topicKey: snapshot.topicKey, inputHash: hash(comparableInput(noStyle.input)) };
}

function telemetry(job, logs) {
  const startedAt = job.startedAt ? new Date(job.startedAt).getTime() : NaN;
  const completedAt = job.completedAt ? new Date(job.completedAt).getTime() : NaN;
  const calls = logs.map((log) => {
    const pricing = record(log.pricingSnapshot);
    return {
      stage: log.stage ?? (log.apiStyle === "images" ? "image_generation" : log.scene),
      apiStyle: log.apiStyle,
      model: log.model,
      success: log.success,
      attempt: log.attempt,
      latencyMs: log.latencyMs,
      firstTokenLatencyMs: log.firstTokenLatencyMs,
      inputTokens: log.inputTokens,
      outputTokens: log.outputTokens,
      costCny: typeof pricing.cost === "number" ? pricing.cost : null,
      priceSnapshot: pricing.cost === undefined ? null : { effectiveAt: pricing.effectiveAt, priceTier: pricing.priceTier },
    };
  });
  const sum = (key) => calls.reduce((total, call) => total + (typeof call[key] === "number" ? call[key] : 0), 0);
  const textCalls = calls.filter((call) => call.apiStyle !== "images");
  const textSum = (key) => textCalls.reduce((total, call) => total + (typeof call[key] === "number" ? call[key] : 0), 0);
  const stageRetries = calls.filter((call) => Number(call.attempt) > 1).length;
  const jobRetries = Math.max(0, (Number(job.attempts) || 1) - 1);
  return {
    wallMs: Number.isFinite(startedAt) && Number.isFinite(completedAt) ? completedAt - startedAt : null,
    calls,
    callLatencySumMs: sum("latencyMs"),
    stageRetries,
    jobRetries,
    inputTokens: textCalls.length && textCalls.every((call) => typeof call.inputTokens === "number") ? textSum("inputTokens") : null,
    outputTokens: textCalls.length && textCalls.every((call) => typeof call.outputTokens === "number") ? textSum("outputTokens") : null,
    generatedImageCalls: calls.filter((call) => call.apiStyle === "images" && call.success).length,
    costCny: calls.length && calls.every((call) => call.costCny !== null) ? Number(sum("costCny").toFixed(6)) : null,
    missingPriceCalls: calls.filter((call) => call.costCny === null).length,
    missingUsageCalls: textCalls.filter((call) => typeof call.inputTokens !== "number" || typeof call.outputTokens !== "number").length,
    firstTokenByStage: Object.fromEntries(calls.filter((call) => call.success && TEXT_STAGES.has(call.stage) && typeof call.firstTokenLatencyMs === "number")
      .map((call) => [call.stage, call.firstTokenLatencyMs])),
  };
}

function prepareData(cases, jobsById, logsByJob, coin = () => randomInt(2), contentsById) {
  validateCases(cases);
  const jobIds = cases.flatMap((item) => [item.noStyleJobId, item.styleJobId]);
  if (new Set(jobIds).size !== jobIds.length) throw new Error("A generated job may appear in only one case");
  const contentIds = jobIds.map((jobId) => jobsById[jobId]?.contentId);
  if (contentIds.some((id) => !id) || new Set(contentIds).size !== contentIds.length) throw new Error("Each variant needs its own committed article");
  const pairs = cases.map((item) => {
    const noStyle = jobsById[item.noStyleJobId];
    const styled = jobsById[item.styleJobId];
    const match = validatePair(item, noStyle, styled, logsByJob);
    if (contentsById) {
      const { countArticleCharacters, ARTICLE_TITLE_MAX_LENGTH, ARTICLE_BODY_MAX_LENGTH } = require("@aicp/shared");
      for (const job of [noStyle, styled]) {
        const content = contentsById[job.contentId];
        if (!content || content.authorId !== job.userId) throw new Error(`Case ${item.id}: committed article is missing or belongs to another author`);
        if (countArticleCharacters(content.title) > ARTICLE_TITLE_MAX_LENGTH || countArticleCharacters(content.body) > ARTICLE_BODY_MAX_LENGTH) {
          throw new Error(`Case ${item.id}: committed article exceeds 25/1000 characters`);
        }
      }
    }
    const variants = [
      { condition: "no_style", jobId: noStyle.id, title: noStyle.result.title, body: noStyle.result.bodyMarkdown, telemetry: telemetry(noStyle, logsByJob[noStyle.id] ?? []) },
      { condition: "topic_style", jobId: styled.id, title: styled.result.title, body: styled.result.bodyMarkdown, telemetry: telemetry(styled, logsByJob[styled.id] ?? []) },
    ];
    const flip = coin() === 1;
    return {
      id: item.id, category: item.category, brief: item.brief,
      styleVersionId: match.versionId, topicKey: match.topicKey, inputHash: match.inputHash,
      A: variants[flip ? 1 : 0], B: variants[flip ? 0 : 1],
    };
  });
  return { runId: randomUUID(), createdAt: new Date().toISOString(), pairs };
}

function blindCards(data) {
  return ["# 写作风格盲测", "", "请只根据本次要求与新素材评判，A/B 顺序已随机化。不要打开 answer-key.json。", "",
    ...data.pairs.flatMap((pair) => [
      `## ${pair.id} · ${pair.category === "travel" ? "旅游" : "研究生生活"}`,
      "", pair.brief, "", "### A", "", pair.A.title, "", pair.A.body, "", "### B", "", pair.B.title, "", pair.B.body, "",
    ])].join("\n");
}

function ratingTemplate(data) {
  const empty = () => Object.fromEntries(RATING_FIELDS.map((field) => [field, null]));
  return { runId: data.runId, cases: data.pairs.map((pair) => ({ id: pair.id, preferred: null, A: empty(), B: empty(), notes: "" })) };
}

function buildReport(data, ratings) {
  if (ratings.runId !== data.runId) throw new Error("Ratings belong to a different blind run");
  if (!Array.isArray(ratings.cases) || new Set(ratings.cases.map((item) => item.id)).size !== ratings.cases.length) throw new Error("Ratings must contain unique case IDs");
  const byId = new Map((ratings.cases ?? []).map((item) => [item.id, item]));
  const totals = { no_style: {}, topic_style: {} };
  const sums = { no_style: {}, topic_style: {} };
  const counts = { no_style: {}, topic_style: {} };
  const preferences = { topic_style: 0, no_style: 0, tie: 0, missing: 0 };
  const categoryPreferences = {
    travel: { topic_style: 0, no_style: 0, tie: 0, missing: 0 },
    graduate_life: { topic_style: 0, no_style: 0, tie: 0, missing: 0 },
  };
  const failures = [];
  let unscoredCases = 0;
  for (const pair of data.pairs) {
    const rating = byId.get(pair.id);
    const preferred = rating?.preferred;
    let scored = true;
    for (const letter of ["A", "B"]) {
      for (const field of RATING_FIELDS) {
        const value = rating?.[letter]?.[field];
        const valid = typeof value === "number" && Number.isFinite(value) && value >= 0
          && (!["styleSimilarity", "structureFit", "keyFactCoverage"].includes(field) || (Number.isInteger(value) && value >= 1 && value <= 5))
          && (field !== "oldFactMisuse" || Number.isInteger(value));
        if (!valid) scored = false;
      }
    }
    if (!scored) unscoredCases += 1;
    const choice = preferred !== "A" && preferred !== "B" && preferred !== "tie"
      ? "missing" : preferred === "tie" ? "tie" : pair[preferred].condition;
    preferences[choice] += 1;
    categoryPreferences[pair.category][choice] += 1;
    for (const letter of ["A", "B"]) {
      const variant = pair[letter];
      const condition = variant.condition;
      for (const field of RATING_FIELDS) {
        const value = rating?.[letter]?.[field];
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
        sums[condition][field] = (sums[condition][field] ?? 0) + value;
        counts[condition][field] = (counts[condition][field] ?? 0) + 1;
      }
      for (const field of ["wallMs", "inputTokens", "outputTokens", "costCny", "stageRetries", "jobRetries", "generatedImageCalls"]) {
        const value = variant.telemetry[field];
        if (typeof value !== "number") continue;
        sums[condition][field] = (sums[condition][field] ?? 0) + value;
        counts[condition][field] = (counts[condition][field] ?? 0) + 1;
      }
      for (const [stage, latency] of Object.entries(variant.telemetry.firstTokenByStage ?? {})) {
        const key = `firstTokenMs.${stage}`;
        sums[condition][key] = (sums[condition][key] ?? 0) + latency;
        counts[condition][key] = (counts[condition][key] ?? 0) + 1;
      }
    }
    const styleLetter = pair.A.condition === "topic_style" ? "A" : "B";
    if ((preferred === "A" || preferred === "B" || preferred === "tie") && preferred !== styleLetter || Number(rating?.[styleLetter]?.oldFactMisuse) > 0) {
      failures.push({ id: pair.id, category: pair.category, reason: rating?.notes || (preferred === "tie" ? "tie" : "baseline_preferred") });
    }
  }
  for (const condition of ["no_style", "topic_style"]) {
    for (const [field, total] of Object.entries(sums[condition])) totals[condition][field] = Number((total / counts[condition][field]).toFixed(3));
  }
  const complete = preferences.missing === 0 && unscoredCases === 0;
  return {
    runId: data.runId, total: data.pairs.length, preferences, categoryPreferences,
    unscoredCases,
    target: { preferredStyleAtLeast: 14, met: complete ? preferences.topic_style >= 14 : null },
    averages: totals, coverage: counts, failures,
    complete,
    limitations: ["Ratings are author judgments, not a statistical proof", "Price is a stored list-price estimate; null means unpriced calls", "Use a new holdout set after prompt or profile changes"],
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function caseTemplate() {
  return { cases: ["travel", "graduate_life"].flatMap((category) => Array.from({ length: 10 }, (_, index) => ({
    id: `${category}-${String(index + 1).padStart(2, "0")}`,
    category,
    brief: "",
    noStyleJobId: "",
    styleJobId: "",
    styleVersionId: "",
    topicKey: "",
  }))) };
}

async function main() {
  const [command, inputPath, outputPath] = process.argv.slice(2);
  if (command === "template" && inputPath) {
    const file = path.resolve(inputPath);
    if (fs.existsSync(file)) throw new Error("Template destination already exists");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(caseTemplate(), null, 2) + "\n");
    console.log(`Created 20-case template at ${file}`);
    return;
  }
  if (!command || !inputPath || !outputPath) throw new Error("Usage: node scripts/writing-style-eval.cjs template <cases.json> | prepare <cases.json> <output-dir> | report <output-dir> <report.json>");
  if (command === "report") {
    const data = readJson(path.join(inputPath, "answer-key.json"));
    const ratings = readJson(path.join(inputPath, "ratings.json"));
    const report = buildReport(data, ratings);
    fs.writeFileSync(path.resolve(outputPath), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ complete: report.complete, preferences: report.preferences, target: report.target }, null, 2));
    return;
  }
  if (command !== "prepare") throw new Error(`Unknown command: ${command}`);
  const cases = readJson(inputPath).cases;
  validateCases(cases);
  const directory = path.resolve(outputPath);
  if (fs.existsSync(directory) && fs.readdirSync(directory).length) throw new Error("Output directory must be empty; keep each blind run immutable");
  require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const ids = cases.flatMap((item) => [item.noStyleJobId, item.styleJobId]);
    const [jobs, logs] = await Promise.all([
      prisma.aiJob.findMany({ where: { id: { in: ids } } }),
      prisma.aiCallLog.findMany({ where: { aiJobId: { in: ids } }, orderBy: { createdAt: "asc" } }),
    ]);
    const contentIds = jobs.map((job) => job.contentId).filter(Boolean);
    const contents = await prisma.content.findMany({ where: { id: { in: contentIds } }, select: { id: true, authorId: true, title: true, body: true } });
    const jobsById = Object.fromEntries(jobs.map((job) => [job.id, job]));
    const contentsById = Object.fromEntries(contents.map((content) => [content.id, content]));
    const logsByJob = Object.groupBy ? Object.groupBy(logs, (log) => log.aiJobId) : logs.reduce((groups, log) => {
      (groups[log.aiJobId] ??= []).push(log);
      return groups;
    }, {});
    const data = prepareData(cases, jobsById, logsByJob, undefined, contentsById);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "blind-cards.md"), blindCards(data));
    fs.writeFileSync(path.join(directory, "answer-key.json"), JSON.stringify(data, null, 2) + "\n");
    fs.writeFileSync(path.join(directory, "ratings.json"), JSON.stringify(ratingTemplate(data), null, 2) + "\n");
    console.log(`Prepared ${data.pairs.length} blinded pairs in ${directory}`);
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = { validateCases, validatePair, prepareData, blindCards, ratingTemplate, buildReport, telemetry, caseTemplate };
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
