import { describe, expect, it } from "vitest";
import { aiJobContentId, isAiJobInEditorScope } from "./editor-ai-job-scope";

describe("editor AI job scope", () => {
  it("blocks a completed job from another article", () => {
    expect(isAiJobInEditorScope("article-b", {
      contentId: "article-a",
      input: { contentId: "article-a" },
    })).toBe(false);
  });

  it("uses the payload content id when an older snapshot has no top-level content id", () => {
    const job = { contentId: null, input: { contentId: "article-a" } };
    expect(aiJobContentId(job)).toBe("article-a");
    expect(isAiJobInEditorScope("article-b", job)).toBe(false);
  });

  it("allows a new unsaved article job without a content id", () => {
    expect(isAiJobInEditorScope(null, { contentId: null, input: {} })).toBe(true);
  });

  it("does not let a saved-article job attach itself to a blank editor", () => {
    expect(isAiJobInEditorScope(null, { contentId: "article-a", input: {} })).toBe(false);
  });
});
