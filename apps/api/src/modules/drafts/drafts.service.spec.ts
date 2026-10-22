import { describe, expect, it, vi } from "vitest";
import { DraftsService } from "./drafts.service";

describe("DraftsService autosave", () => {
  it("does not fill omitted fields from a stale read before persistence starts", async () => {
    const findFirst = vi.fn();
    const persist = vi.fn(async () => ({ draft: { id: "draft-1" } }));
    const serializeDraft = vi.fn(() => ({ id: "draft-1" }));
    const service = new DraftsService(
      { content: { findFirst } } as never,
      {} as never,
      { persist, serializeDraft } as never
    );

    await service.autosave("user-1", "content-1", { payload: {} });

    expect(findFirst).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledWith("user-1", expect.objectContaining({
      contentId: "content-1", title: undefined, body: undefined,
    }));
  });
});
