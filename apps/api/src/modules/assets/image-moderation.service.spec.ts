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
      describeImage: vi.fn(() => "A normal landscape"),
      completeWithMetadata: vi.fn(async (options) => ({ text: await complete(options) })),
      attachStructuredResult: vi.fn(),
    } as never);

    const result = await service.reviewImage({ buffer: Buffer.from("image"), mimeType: "image/png" });

    expect(result.auditStatus).toBe(AssetAuditStatus.approved);
    expect(result.riskLevel).toBe("low");
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[0][0].messages[0].content).toContain('"low", "medium", "high"');
    expect(complete.mock.calls[0][0].messages[0].content).toContain("Approved example");
    expect(complete.mock.calls[0][0].messages[0].content).toContain("Rejected example");
  });

  it("remains pending when the single repair is still invalid", async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce('{"pass":true,"level":"safe","reason":"ok","types":["none"]}')
      .mockResolvedValueOnce('{"pass":true,"level":"unknown","reason":"ok","types":["none"]}');
    const service = new ImageModerationService({
      hasRemoteProvider: vi.fn(() => true),
      describeImage: vi.fn(() => "A normal landscape"),
      completeWithMetadata: vi.fn(async (options) => ({ text: await complete(options) })),
      attachStructuredResult: vi.fn(),
    } as never);

    const result = await service.reviewImage({ buffer: Buffer.from("image"), mimeType: "image/png" });

    expect(result.auditStatus).toBe(AssetAuditStatus.pending);
    expect(result.riskLevel).toBe("unknown");
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
