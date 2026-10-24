import { describe, expect, it } from "vitest";

const evalKit = require("../scripts/writing-style-eval.cjs");

function fixture() {
  const cases = Array.from({ length: 20 }, (_, index) => ({
    id: `case-${index + 1}`,
    category: index < 10 ? "travel" : "graduate_life",
    brief: `本次新素材 ${index + 1}`,
    noStyleJobId: `base-${index + 1}`,
    styleJobId: `style-${index + 1}`,
    styleVersionId: "version-1",
    topicKey: index < 10 ? "travel" : "graduate_life",
  }));
  const jobs: Record<string, unknown> = {};
  const logs: Record<string, unknown[]> = {};
  for (const item of cases) {
    const input = { theme: item.brief, materialSnapshot: { currentRequest: item.brief, materialNotes: "新的真实经历" } };
    for (const [jobId, styled] of [[item.noStyleJobId, false], [item.styleJobId, true]] as const) {
      jobs[jobId] = {
        id: jobId, contentId: `content-${jobId}`, userId: "author-1", type: "creative_direct_generate", status: "succeeded",
        input: styled ? { ...input, writingStyleSnapshot: { mode: "topic", versionId: "version-1", topicKey: item.topicKey } } : input,
        result: { title: "标题", bodyMarkdown: "真实素材写成的正文" },
        startedAt: new Date("2026-10-24T00:00:00.000Z"), completedAt: new Date("2026-10-24T00:00:10.000Z"),
      };
      logs[jobId] = ["requirements", "article_draft", "visual_plan"].map((stage) => ({
        stage, success: true, model: "same-model", promptKey: "direct_generate", promptVersionId: "prompt-1",
        thinkingMode: "disabled", apiStyle: "responses", attempt: 1, latencyMs: 1000,
        firstTokenLatencyMs: 100, inputTokens: 100, outputTokens: 50, pricingSnapshot: { cost: 0.01 },
      }));
    }
  }
  return { cases, jobs, logs };
}

describe("writing-style blind evaluation", () => {
  it("creates ten travel and ten graduate-life case slots without fabricated materials", () => {
    const template = evalKit.caseTemplate();
    expect(template.cases).toHaveLength(20);
    expect(template.cases.filter((item: { category: string }) => item.category === "travel")).toHaveLength(10);
    expect(template.cases.every((item: { brief: string; noStyleJobId: string }) => !item.brief && !item.noStyleJobId)).toBe(true);
  });

  it("blinds the 20 paired outputs and reports author preference without exposing the condition", () => {
    const { cases, jobs, logs } = fixture();
    const prepared = evalKit.prepareData(cases, jobs, logs, () => 1);
    expect(prepared.pairs).toHaveLength(20);
    expect(prepared.pairs.every((pair: { A: { condition: string } }) => pair.A.condition === "topic_style")).toBe(true);
    const cards = evalKit.blindCards(prepared);
    expect(cards).not.toContain("topic_style");
    expect(cards).not.toContain("style-1");
    const ratings = evalKit.ratingTemplate(prepared);
    for (const item of ratings.cases) {
      item.preferred = "A";
      for (const letter of ["A", "B"] as const) Object.assign(item[letter], {
        styleSimilarity: 4, structureFit: 4, keyFactCoverage: 4,
        oldFactMisuse: 0, editMinutes: 5, editCharacters: 30,
      });
    }
    const report = evalKit.buildReport(prepared, ratings);
    expect(report.preferences.topic_style).toBe(20);
    expect(report.categoryPreferences.travel.topic_style).toBe(10);
    expect(report.categoryPreferences.graduate_life.topic_style).toBe(10);
    expect(report.target.met).toBe(true);
    expect(report.averages.topic_style.costCny).toBe(0.03);
    expect(report.averages.no_style.wallMs).toBe(10000);
    expect(report.averages.topic_style["firstTokenMs.article_draft"]).toBe(100);
  });

  it("keeps an unfinished rating run incomplete and never treats absent usage as zero", () => {
    const { cases, jobs, logs } = fixture();
    delete (logs[cases[0].styleJobId][0] as { inputTokens?: number }).inputTokens;
    const prepared = evalKit.prepareData(cases, jobs, logs, () => 1);
    const report = evalKit.buildReport(prepared, evalKit.ratingTemplate(prepared));
    expect(report.complete).toBe(false);
    expect(report.unscoredCases).toBe(20);
    expect(report.target.met).toBeNull();
    expect(prepared.pairs[0].A.telemetry.inputTokens).toBeNull();
    expect(prepared.pairs[0].A.telemetry.missingUsageCalls).toBe(1);
  });

  it("counts image prices without requiring token usage from an image request", () => {
    const { cases, jobs, logs } = fixture();
    const jobId = cases[0].styleJobId;
    logs[jobId].push({ stage: "cover_image", apiStyle: "images", success: true, model: "seedream",
      attempt: 1, latencyMs: 1500, inputTokens: null, outputTokens: null, pricingSnapshot: { cost: 0.25 } });
    const result = evalKit.telemetry(jobs[jobId], logs[jobId]);
    expect(result.inputTokens).toBe(300);
    expect(result.outputTokens).toBe(150);
    expect(result.missingUsageCalls).toBe(0);
    expect(result.generatedImageCalls).toBe(1);
    expect(result.costCny).toBe(0.28);
  });

  it("rejects changed materials, model settings, and a baseline that used a style", () => {
    const { cases, jobs, logs } = fixture();
    const styled = jobs[cases[0].styleJobId] as { input: Record<string, unknown> };
    styled.input.materialSnapshot = { currentRequest: "different" };
    expect(() => evalKit.prepareData(cases, jobs, logs)).toThrow("frozen materials differ");
    styled.input.materialSnapshot = (jobs[cases[0].noStyleJobId] as { input: Record<string, unknown> }).input.materialSnapshot;
    (logs[cases[0].styleJobId][0] as { model: string }).model = "different-model";
    expect(() => evalKit.prepareData(cases, jobs, logs)).toThrow("model differs");
    (logs[cases[0].styleJobId][0] as { model: string }).model = "same-model";
    (jobs[cases[0].noStyleJobId] as { input: Record<string, unknown> }).input.writingStyleSnapshot = { mode: "topic" };
    expect(() => evalKit.prepareData(cases, jobs, logs)).toThrow("baseline job used a writing style");
  });

  it("rejects reused draft articles across blind cases", () => {
    const { cases, jobs, logs } = fixture();
    (jobs[cases[1].noStyleJobId] as { contentId: string }).contentId =
      (jobs[cases[0].noStyleJobId] as { contentId: string }).contentId;
    expect(() => evalKit.prepareData(cases, jobs, logs)).toThrow("own committed article");
  });
});
