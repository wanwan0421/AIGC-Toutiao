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
        attachStructuredResult: vi.fn(),
      } as never,
      { render: vi.fn(() => ({ model: "model", modelOptions: {}, promptKey: "key" })) } as never,
      resources as never
    );

    await pipeline.run({ userId: "user", theme: "theme" });

    expect(complete).toHaveBeenCalledTimes(3);
    expect(resources.loadOutputRepair).not.toHaveBeenCalled();
    expect(resources.validateOutput).toHaveBeenCalledTimes(1);
  });
});
