import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { asAppError } from "./app-error";

describe("asAppError", () => {
  it("preserves non-retryable HTTP business errors for background jobs", () => {
    expect(asAppError(new BadRequestException("invalid workflow state"))).toMatchObject({
      code: "BAD_REQUEST",
      message: "invalid workflow state",
      statusCode: 400,
      retryable: false,
    });
  });

  it("marks transient HTTP service errors as retryable", () => {
    expect(asAppError(new ServiceUnavailableException("temporarily unavailable"))).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      statusCode: 503,
      retryable: true,
    });
  });
});
