import { AssetAuditStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ImageModerationService } from "./image-moderation.service";

describe("ImageModerationService", () => {
  it("repairs an invalid structured result exactly once", async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce('{"pass":true,"level":"safe","reason":"ok","types":["none"]}')
      .mockResolvedValueOnce('{"pass":true,"level":"low","reason":"ok","types":["none"]}');
    const service = new ImageModerationService({
      hasRemoteProvider: vi.fn(() => true),
      resolveTimeoutMs: vi.fn(() => 1_000),
      completeWithMetadata: vi.fn(async (options) => ({ text: await complete(options) })),
      attachStructuredResult: vi.fn(),
    } as never);

    const result = await service.reviewImage({ buffer: Buffer.from("image"), mimeType: "image/png" });

    expect(result.auditStatus).toBe(AssetAuditStatus.approved);
    expect(result.riskLevel).toBe("low");
    expect(complete).toHaveBeenCalledTimes(2);
    const request = complete.mock.calls[1][0];
    expect(request.messages[0].content).toContain("unified content-safety standard");
    expect(request.messages[1].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "image_url", image_url: expect.objectContaining({ url: expect.stringContaining("data:image/png;base64,") }) }),
      expect.objectContaining({ type: "text" }),
    ]));
    expect(request.responseFormat.name).toBe("image_moderation");
    expect(request.responseFormat.schema).toBeDefined();
  });

  it("remains pending when the single repair is still invalid", async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce('{"pass":true,"level":"safe","reason":"ok","types":["none"]}')
      .mockResolvedValueOnce('{"pass":true,"level":"unknown","reason":"ok","types":["none"]}');
    const service = new ImageModerationService({
      hasRemoteProvider: vi.fn(() => true),
      resolveTimeoutMs: vi.fn(() => 1_000),
      completeWithMetadata: vi.fn(async (options) => ({ text: await complete(options) })),
      attachStructuredResult: vi.fn(),
    } as never);

    const result = await service.reviewImage({ buffer: Buffer.from("image"), mimeType: "image/png" });

    expect(result.auditStatus).toBe(AssetAuditStatus.pending);
    expect(result.riskLevel).toBe("unknown");
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
