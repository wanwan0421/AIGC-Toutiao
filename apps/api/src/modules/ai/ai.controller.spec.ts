import { describe, expect, it, vi } from "vitest";
import { AiJobType } from "@aicp/shared";
import { AiController } from "./ai.controller";

const user = { id: "user-1" };

function createController() {
  const jobs = { create: vi.fn().mockResolvedValue({ id: "job-1" }) };
  return {
    controller: new AiController({} as never, jobs as never, {} as never),
    jobs,
  };
}

describe("AiController idempotency key transport", () => {
  it("uses the request-body mirror when a proxy omits the header", async () => {
    const { controller, jobs } = createController();

    await controller.startJob(user as never, {
      type: AiJobType.CreativeImageGenerate,
      payload: { prompt: "cover" },
      idempotencyKey: "body-key",
    });

    expect(jobs.create).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "body-key" }));
  });

  it("prefers the Idempotency-Key header over the mirrored body value", async () => {
    const { controller, jobs } = createController();

    await controller.startJob(user as never, {
      type: AiJobType.CreativeImageGenerate,
      payload: { prompt: "cover" },
      idempotencyKey: "body-key",
    }, "header-key");

    expect(jobs.create).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "header-key" }));
  });

  it("treats an empty proxy header as missing", async () => {
    const { controller, jobs } = createController();

    await controller.startJob(user as never, {
      type: AiJobType.CreativeImageGenerate,
      payload: { prompt: "cover" },
      idempotencyKey: "body-key",
    }, "  ");

    expect(jobs.create).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "body-key" }));
  });

  it("does not leak the compatibility field into a legacy image-job payload", async () => {
    const { controller, jobs } = createController();

    await controller.startCreativeImageJob(user as never, {
      prompt: "cover",
      idempotencyKey: "body-key",
    });

    expect(jobs.create).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "body-key",
      payload: { prompt: "cover" },
    }));
  });
});
