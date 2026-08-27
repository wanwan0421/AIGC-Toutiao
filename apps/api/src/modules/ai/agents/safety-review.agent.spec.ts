import { describe, expect, it, vi } from "vitest";
import { SafetyReviewAgent } from "./safety-review.agent";

const validResult = {
  passed: true,
  riskLevel: "low",
  riskTypes: ["none"],
  categoryScores: {
    pornography: 0,
    gambling: 0,
    drug: 0,
    sensitive: 0,
    vulgar: 0,
    privacy: 0,
    illegal: 0,
    fraud: 0,
    minor: 0,
  },
  riskItems: [],
  reasons: ["未发现明显合规风险"],
  rewriteAvailable: false,
};

describe("SafetyReviewAgent structured output repair", () => {
  it("requests one repair when the first candidate fails Zod validation", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ passed: true }))
      .mockResolvedValueOnce(JSON.stringify(validResult));
    const modelClient = {
      completeWithMetadata: vi.fn(async (options) => ({ text: await complete(options) })),
      attachStructuredResult: vi.fn(),
    };
    const prompts = {
      render: vi.fn().mockResolvedValue({
        promptKey: "safety_review",
        promptVersionId: "v1",
        model: "test-model",
        modelOptions: { temperature: 0.15 },
        prompt: "passed riskLevel riskTypes categoryScores riskItems evidence severity confidence rewriteAvailable",
      }),
    };
    const agent = new SafetyReviewAgent(modelClient as never, prompts as never);

    const input = { title: "普通标题", body: "普通正文", ruleRiskItems: [] };
    const result = await agent.run(input);

    expect(result.passed).toBe(true);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(prompts.render).toHaveBeenCalledWith("safety_review", {}, expect.any(String));
    expect(complete.mock.calls[0][0].messages[0]).toEqual({
      role: "system",
      content: "passed riskLevel riskTypes categoryScores riskItems evidence severity confidence rewriteAvailable",
    });
    expect(JSON.parse(complete.mock.calls[0][0].messages[1].content)).toEqual(input);
    expect(complete.mock.calls[0][0].responseFormat).toMatchObject({ type: "json_schema", strict: true });
    expect(complete.mock.calls[1][0].messages.at(-1).content).toContain("未通过 JSON Schema 验证");
  });
});
