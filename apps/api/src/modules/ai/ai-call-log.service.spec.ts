import { describe, expect, it, vi } from "vitest";
import { AiCallLogService } from "./ai-call-log.service";

describe("AiCallLogService private creative materials", () => {
  it("stores only fingerprints for both direct generation and routing", async () => {
    const prisma = {
      aiCallLog: {
        create: vi.fn(async (args: unknown) => args),
        updateMany: vi.fn(async (_args: unknown) => ({ count: 1 })),
      },
    };
    const service = new AiCallLogService(prisma as never);
    await service.log({
      scene: "direct_generate", inputSummary: "私人旅行原文", output: { text: "私人旅行原文" },
      success: true,
    });
    await service.log({
      scene: "skill_router", inputSummary: "私人旅行原文", output: { text: "私人旅行原文" },
      success: true,
    });
    const first = (prisma.aiCallLog.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    const second = (prisma.aiCallLog.create.mock.calls[1]?.[0] as { data: Record<string, unknown> }).data;
    expect(first.inputSummary).toEqual(second.inputSummary);
    expect(first.output).toEqual(second.output);
    expect(String(first.inputSummary)).toMatch(/^sha256:[a-f0-9]{64};chars:\d+$/);
    expect(first.output).toMatchObject({ kind: "text", sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(JSON.stringify(first)).not.toContain("私人旅行原文");
    expect(JSON.stringify(second)).not.toContain("私人旅行原文");

    await service.attachResult("call-1", { text: "私人旅行原文" });
    const attached = prisma.aiCallLog.updateMany.mock.calls[0]?.[0] as { where: { id: string }; data: Record<string, unknown> };
    expect(attached.where).toEqual({ id: "call-1" });
    expect(JSON.stringify(attached)).not.toContain("私人旅行原文");
    expect(attached.data.output).toMatchObject({ sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });

  it("stores the model and image list-price snapshot on each call", async () => {
    const prisma = { aiCallLog: { create: vi.fn(async (args: unknown) => args), updateMany: vi.fn() } };
    const service = new AiCallLogService(prisma as never);
    await service.log({
      scene: "direct_generate", stage: "article_draft", attempt: 2, model: "doubao-seed-evolving",
      apiStyle: "responses", inputTokens: 1_000_000, cachedInputTokens: 200_000, outputTokens: 100_000,
      success: true,
    });
    const tokenSnapshot = (prisma.aiCallLog.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data.pricingSnapshot as Record<string, unknown>;
    expect(tokenSnapshot).toMatchObject({
      currency: "CNY", inputPerMillion: 6, cachedInputPerMillion: 1.2, outputPerMillion: 30,
      inputCost: 4.8, cachedInputCost: 0.24, outputCost: 3, cost: 8.04,
    });
    expect(prisma.aiCallLog.create.mock.calls[0]?.[0]).toMatchObject({ data: { stage: "article_draft", attempt: 2 } });

    await service.log({ scene: "creative_image_generate", stage: "cover_image", model: "doubao-seedream-4-5", apiStyle: "images", billingUnits: 1, success: true });
    const imageSnapshot = (prisma.aiCallLog.create.mock.calls[1]?.[0] as { data: Record<string, unknown> }).data.pricingSnapshot as Record<string, unknown>;
    expect(imageSnapshot).toMatchObject({ currency: "CNY", billingUnit: "image", units: 1, unitPrice: 0.25, cost: 0.25 });
  });
});
