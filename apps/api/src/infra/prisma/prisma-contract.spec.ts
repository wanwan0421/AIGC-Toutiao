import { AiJobType as PrismaAiJobType, type PrismaClient } from "@prisma/client";
import { AiJobType as SharedAiJobType } from "@aicp/shared";
import { describe, expect, expectTypeOf, it } from "vitest";

describe("Prisma generated contract", () => {
  it("keeps the shared and persisted AI job types synchronized", () => {
    expect(Object.values(PrismaAiJobType).sort()).toEqual(Object.values(SharedAiJobType).sort());
    expectTypeOf<`${SharedAiJobType}`>().toEqualTypeOf<PrismaAiJobType>();
  });

  it("exposes the Responses conversation delegates", () => {
    expectTypeOf<PrismaClient["aiConversationProviderSession"]>().not.toBeNever();
    expectTypeOf<PrismaClient["aiConversationSummary"]>().not.toBeNever();
  });
});
