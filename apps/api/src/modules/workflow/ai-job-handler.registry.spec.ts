import { describe, expect, it, vi } from "vitest";
import { AiJobType } from "@aicp/shared";
import { AiJobHandlerRegistry } from "./ai-job-handler.registry";

describe("AiJobHandlerRegistry", () => {
  it("dispatches a job to its registered handler", async () => {
    const registry = new AiJobHandlerRegistry();
    const handler = vi.fn(async () => ({ ok: true }));
    registry.register(AiJobType.CreativeDirectGenerate, handler);

    const result = await registry.execute({
      jobId: "job-1",
      runToken: "run-1",
      type: AiJobType.CreativeDirectGenerate,
      payload: {},
      userId: "user-1",
    });

    expect(result).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("rejects duplicate registrations and unsupported job types", async () => {
    const registry = new AiJobHandlerRegistry();
    registry.register(AiJobType.CreativeChat, async () => null);
    expect(() => registry.register(AiJobType.CreativeChat, async () => null)).toThrow(/already registered/);
    expect(() => registry.execute({
      jobId: "job-2",
      runToken: "run-2",
      type: AiJobType.PromptEvalRun,
      payload: {},
      userId: "user-1",
    })).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_AI_JOB_TYPE" }));
  });
});
