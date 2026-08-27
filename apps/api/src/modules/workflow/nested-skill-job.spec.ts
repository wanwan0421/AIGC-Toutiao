import { describe, expect, it, vi } from "vitest";
import { AiJobType } from "@aicp/shared";
import { WorkflowJobRunner } from "./workflow-job.runner";
import { AiJobPayloadValidator } from "./ai-job-payload.validator";

describe("nested Skill jobs", () => {
  it("uses WorkflowJobService.create with a stable parent-scoped idempotency key", async () => {
    const create = vi.fn(async (input) => ({ id: "nested-1", ...input }));
    const runner = new WorkflowJobRunner(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { create } as never,
      { register: vi.fn() } as never,
    );

    const result = await (runner as unknown as {
      createNestedJob: (...args: unknown[]) => Promise<unknown>;
    }).createNestedJob(
      "parent-1",
      "user-1",
      "conversation-1",
      "assistant-1",
      { type: AiJobType.ContentSubmitReview, contentId: "content-1", payload: { source: "conversation", message: "审核" } },
    );

    expect(result).toMatchObject({ id: "nested-1" });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      conversationId: "conversation-1",
      assistantMessageId: "assistant-1",
      idempotencyKey: `nested:parent-1:${AiJobType.ContentSubmitReview}`,
    }));
  });

  it("strictly validates conversation-originated Skill payloads", () => {
    const validator = new AiJobPayloadValidator();
    expect(validator.parse(AiJobType.CreativeDirectGenerate, {
      theme: "主题",
      source: "conversation",
      message: "生成完整图文",
      currentTitle: "标题",
      currentBody: "正文",
      historyText: "历史",
      conversationId: "conversation-1",
    })).toMatchObject({ source: "conversation" });

    expect(() => validator.parse(AiJobType.ContentSubmitReview, {
      contentId: "content-1",
      source: "conversation",
      message: "审核",
      unexpected: true,
    })).toThrow();
  });

  it("validates title, selection rewrite, and text moderation job payloads", () => {
    const validator = new AiJobPayloadValidator();

    expect(validator.parse(AiJobType.CreativeTitleGenerate, { body: "article" })).toEqual({ body: "article" });
    expect(validator.parse(AiJobType.CreativeSelectionRewrite, {
      selectedText: "before",
      action: "polish",
    })).toEqual({ selectedText: "before", action: "polish" });
    expect(validator.parse(AiJobType.ModerationTextRun, { title: "title", body: "body" })).toEqual({
      title: "title",
      body: "body",
    });
  });
});
