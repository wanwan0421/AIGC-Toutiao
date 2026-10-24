import { describe, expect, it, vi } from "vitest";
import { ContentProductionResourceOrchestrator } from "./content-production-resource.orchestrator";
import { SkillRegistryService } from "../skills-runtime/skill-registry.service";
import { ContentDraftPipeline } from "./content-draft.pipeline";

describe("ContentProductionResourceOrchestrator", () => {
  it("loads only the resources authorized for each stage and executes validation server-side", () => {
    const registry = {
      loadSkillInstructions: vi.fn(() => ({
        key: "content-production-line",
        name: "content-production-line",
        description: "test",
        fallbackBody: "instructions",
      })),
      formatSkillInstructions: vi.fn(() => "skill context"),
      modelResourceText: vi.fn(() => "stage context"),
      executeScriptExport: vi.fn(() => ({ ok: true, errors: [], value: {} })),
    } as unknown as SkillRegistryService;
    const orchestrator = new ContentProductionResourceOrchestrator(registry);

    expect(orchestrator.loadSelectedSkill()).toBe("skill context");
    orchestrator.loadRequirementAnalysis();
    orchestrator.loadArticleWriting();
    orchestrator.loadVisualPlanning();
    orchestrator.loadOutputRepair();
    orchestrator.validateOutput({ title: "test" });

    expect(registry.modelResourceText).toHaveBeenNthCalledWith(1, "content-production-line", {
      prompts: ["01-requirement-analyzer.md"],
    });
    expect(registry.modelResourceText).toHaveBeenNthCalledWith(2, "content-production-line", {
      prompts: ["02-article-draft-writer.md"],
      references: ["toutiao-style-guide.md"],
    });
    expect(registry.modelResourceText).toHaveBeenNthCalledWith(3, "content-production-line", {
      prompts: ["03-visual-plan.md"],
      assets: ["visual-style-presets.json"],
    });
    expect(registry.modelResourceText).toHaveBeenNthCalledWith(4, "content-production-line", {
      prompts: ["04-output-normalizer.md"],
      references: ["output-schema.md"],
    });
    expect(registry.executeScriptExport).toHaveBeenCalledWith(
      "content-production-line",
      "validate_direct_generate_result.cjs",
      "validateDirectGenerateResult",
      { title: "test" }
    );
  });

  it("builds the router catalog without reading SKILL.md", () => {
    const registry = new SkillRegistryService();
    const load = vi.spyOn(registry, "loadSkillInstructions");

    const catalog = registry.listForRouter();

    expect(catalog.length).toBeGreaterThan(0);
    expect(load).not.toHaveBeenCalled();
    expect(Object.keys(catalog[0]).sort()).toEqual(["description", "key", "name"]);
  });

  it("does not load repair resources when server validation succeeds", async () => {
    const previousThinkingMode = process.env.AI_CONTENT_PRODUCTION_THINKING_MODE;
    process.env.AI_CONTENT_PRODUCTION_THINKING_MODE = "disabled";
    const streamOptions: Array<{ thinking?: string }> = [];
    const complete = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({
        needsClarification: false,
        clarificationQuestion: "",
        theme: "theme",
        audience: "",
        style: "",
        viewpoint: "",
        materialNotes: "",
        sourceSummary: "button",
      }))
      .mockResolvedValueOnce(JSON.stringify({
        title: "Title",
        titleCandidates: [],
        bodyMarkdown: "Body",
        tags: ["#tag"],
        outline: [],
      }))
      .mockResolvedValueOnce(JSON.stringify({ bodyMarkdown: "Body", coverSuggestion: "cover", imagePrompts: [] }));
    const finalValue = {
      title: "Title",
      titleCandidates: [],
      bodyMarkdown: "Body",
      tags: ["#tag"],
      outline: [],
      coverSuggestion: "cover",
      imagePrompts: [],
      imageAssets: [],
    };
    const resources = {
      loadSelectedSkill: vi.fn(() => "skill"),
      loadRequirementAnalysis: vi.fn(() => "requirement"),
      loadArticleWriting: vi.fn(() => "article"),
      loadVisualPlanning: vi.fn(() => "visual"),
      loadOutputRepair: vi.fn(() => "repair"),
      validateOutput: vi.fn(() => ({ ok: true, errors: [], value: finalValue })),
    };
    const pipeline = new ContentDraftPipeline(
      {
        completeWithMetadata: vi.fn(async (options) => ({ text: await complete(options) })),
        completeStreamingWithMetadata: vi.fn(async (options) => {
          streamOptions.push(options);
          return { text: await complete(options) };
        }),
        attachStructuredResult: vi.fn(),
      } as never,
      { render: vi.fn(() => ({ model: "model", modelOptions: {}, promptKey: "key" })) } as never,
      resources as never
    );
    const onStage = vi.fn(async () => undefined);

    try {
      await pipeline.run({ userId: "user", theme: "theme" }, { onStage });
    } finally {
      if (previousThinkingMode === undefined) delete process.env.AI_CONTENT_PRODUCTION_THINKING_MODE;
      else process.env.AI_CONTENT_PRODUCTION_THINKING_MODE = previousThinkingMode;
    }

    expect(complete).toHaveBeenCalledTimes(3);
    expect(streamOptions.map((options) => options.thinking)).toEqual(["disabled", "disabled", "disabled"]);
    expect(resources.loadOutputRepair).not.toHaveBeenCalled();
    expect(resources.validateOutput).toHaveBeenCalledTimes(1);
    expect(onStage.mock.calls).toEqual([
      ["requirements", "started"], ["requirements", "completed"],
      ["article_draft", "started"], ["article_draft", "completed"],
      ["visual_plan", "started"], ["visual_plan", "completed"],
    ]);
  });

  it.each([true, false])("allows at most two server-validated output repairs (second succeeds: %s)", async (secondSucceeds) => {
    const requirement = {
      needsClarification: false, clarificationQuestion: "", theme: "主题", audience: "", style: "",
      viewpoint: "", materialNotes: "", sourceSummary: "button",
    };
    const draft = { title: "标题", titleCandidates: [], bodyMarkdown: "正文", tags: ["#主题"], outline: [] };
    const visual = { bodyMarkdown: "正文", coverSuggestion: "封面", imagePrompts: [] };
    const repaired = { ...draft, ...visual };
    const complete = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(requirement))
      .mockResolvedValueOnce(JSON.stringify(draft))
      .mockResolvedValueOnce(JSON.stringify(visual))
      .mockResolvedValueOnce(JSON.stringify(repaired))
      .mockResolvedValueOnce(JSON.stringify(repaired));
    const invalid = { ok: false, errors: ["bodyMarkdown visible text exceeds 1000 characters"], value: repaired };
    const valid = { ok: true, errors: [], value: repaired };
    const resources = {
      loadSelectedSkill: vi.fn(() => "skill"),
      loadRequirementAnalysis: vi.fn(() => "requirement"),
      loadArticleWriting: vi.fn(() => "article"),
      loadVisualPlanning: vi.fn(() => "visual"),
      loadOutputRepair: vi.fn(() => "repair"),
      validateOutput: vi.fn().mockReturnValueOnce(invalid).mockReturnValueOnce(invalid)
        .mockReturnValueOnce(secondSucceeds ? valid : invalid),
    };
    const pipeline = new ContentDraftPipeline(
      { completeWithMetadata: vi.fn(async (options) => ({ text: await complete(options) })), completeStreamingWithMetadata: vi.fn(async (options) => ({ text: await complete(options) })), attachStructuredResult: vi.fn() } as never,
      { render: vi.fn(() => ({ model: "model", modelOptions: {}, promptKey: "key" })) } as never,
      resources as never
    );

    if (secondSucceeds) {
      await expect(pipeline.run({ userId: "user", theme: "主题" })).resolves.toEqual(repaired);
    } else {
      await expect(pipeline.run({ userId: "user", theme: "主题" })).rejects.toThrow("output invalid");
    }
    expect(complete).toHaveBeenCalledTimes(5);
    expect(resources.loadOutputRepair).toHaveBeenCalledTimes(2);
    expect(resources.validateOutput).toHaveBeenCalledTimes(3);
  });
});
