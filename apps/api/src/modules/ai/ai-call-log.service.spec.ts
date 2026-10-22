import { describe, expect, it, vi } from "vitest";
import { AiCallLogService } from "./ai-call-log.service";

describe("AiCallLogService private creative materials", () => {
  it("does not record creative request summaries or model output in call logs", async () => {
    const prisma = {
      aiCallLog: {
        create: vi.fn(async (args: unknown) => args),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    const service = new AiCallLogService(prisma as never);
    await service.log({
      scene: "direct_generate", inputSummary: "私人旅行原文", output: { text: "私人旅行原文" },
      success: true,
    });
    expect(prisma.aiCallLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ inputSummary: undefined, output: undefined }),
    }));

    await service.attachResult("call-1", { text: "私人旅行原文" });
    expect(prisma.aiCallLog.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "call-1", scene: { notIn: ["direct_generate", "creative_chat"] } },
    }));
  });
});
