import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ModelClientService } from "./model-client.service";
import { completeStructured } from "./structured-output";

const originalApiKey = process.env.ARK_API_KEY;
const originalModel = process.env.ARK_MODEL_ID;
const originalApiUrl = process.env.ARK_API_URL;
const originalResponsesUrl = process.env.ARK_RESPONSES_API_URL;

describe("ModelClientService thinking mode", () => {
  beforeEach(() => {
    process.env.ARK_API_KEY = "test-key";
    process.env.ARK_MODEL_ID = "test-model";
  });

  afterEach(() => {
    restoreEnv("ARK_API_KEY", originalApiKey);
    restoreEnv("ARK_MODEL_ID", originalModel);
    restoreEnv("ARK_API_URL", originalApiUrl);
    restoreEnv("ARK_RESPONSES_API_URL", originalResponsesUrl);
    vi.unstubAllGlobals();
  });

  it("enables thinking by default for Chat Completions", async () => {
    process.env.ARK_API_URL = "https://example.test/api/v3/chat/completions";
    const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    vi.stubGlobal("fetch", fetchMock);

    await new ModelClientService().complete({ messages: [{ role: "user", content: "hello" }] });

    expect(requestBody(fetchMock).thinking).toEqual({ type: "enabled" });
  });

  it("disables thinking per call for Chat Completions", async () => {
    process.env.ARK_API_URL = "https://example.test/api/v3/chat/completions";
    const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    vi.stubGlobal("fetch", fetchMock);

    await new ModelClientService().complete({
      messages: [{ role: "user", content: "hello" }],
      thinking: "disabled",
    });

    expect(requestBody(fetchMock).thinking).toEqual({ type: "disabled" });
  });

  it("uses the same thinking contract for Responses", async () => {
    process.env.ARK_API_URL = "https://example.test/api/v3/responses";
    const fetchMock = vi.fn(async () => jsonResponse({
      output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await new ModelClientService().complete({
      messages: [{ role: "user", content: "hello" }],
      thinking: "disabled",
    });

    expect(requestBody(fetchMock).thinking).toEqual({ type: "disabled" });
  });

  it("enables thinking by default for tool calls", async () => {
    process.env.ARK_API_URL = "https://example.test/api/v3/chat/completions";
    const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "ok", tool_calls: [] } }] }));
    vi.stubGlobal("fetch", fetchMock);

    await new ModelClientService().completeWithTools({
      messages: [{ role: "user", content: "hello" }],
      tools: [],
    });

    expect(requestBody(fetchMock).thinking).toEqual({ type: "enabled" });
  });

  it("stores a validated structured result on the same provider call log", async () => {
    process.env.ARK_API_URL = "https://example.test/api/v3/chat/completions";
    const fetchMock = vi.fn(async () => jsonResponse({
      id: "call-1",
      model: "test-model",
      choices: [{ message: { content: JSON.stringify({ value: "ok" }) } }],
      usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const callLogs = {
      log: vi.fn(async (_data: unknown) => ({ id: "log-1" })),
      attachResult: vi.fn(async () => ({ count: 1 })),
    };
    const service = new ModelClientService(callLogs as never);

    const result = await completeStructured({
      modelClient: service,
      name: "test_structured",
      schema: z.object({ value: z.string() }),
      telemetry: {
        aiJobId: "job-1",
        contentId: "content-1",
        conversationId: "conversation-1",
      },
      messages: [{ role: "user", content: "return json" }],
    });

    expect(result).toEqual({ value: "ok" });
    expect(callLogs.log).toHaveBeenCalledTimes(1);
    expect(callLogs.log).toHaveBeenCalledWith(expect.objectContaining({
      aiJobId: "job-1",
      contentId: "content-1",
      conversationId: "conversation-1",
      provider: "volcengine_ark",
      apiStyle: "chat_completions",
      inputSummary: JSON.stringify([{ role: "user", content: "return json" }]),
      inputTokens: 10,
      outputTokens: 3,
      totalTokens: 13,
    }));
    expect(callLogs.log.mock.calls[0]?.[0]).not.toHaveProperty("cacheType");
    expect(callLogs.attachResult).toHaveBeenCalledWith(
      "log-1",
      { value: "ok" },
      { success: true },
    );
  });

  it("sends native Responses messages, previous_response_id and session caching", async () => {
    process.env.ARK_API_URL = "https://example.test/api/v3/chat/completions";
    process.env.ARK_RESPONSES_API_URL = "https://example.test/api/v3/responses";
    const fetchMock = vi.fn(async () => jsonResponse({
      id: "resp-2",
      previous_response_id: "resp-1",
      expire_at: 1_800_000_000,
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new ModelClientService().completeWithMetadata({
      apiStyle: "responses",
      cacheStrategy: "session",
      store: true,
      previousResponseId: "resp-1",
      messages: [{ role: "user", content: "only the new turn" }],
    });

    const body = requestBody(fetchMock);
    expect((fetchMock.mock.calls as unknown[][])[0]?.[0]).toBe("https://example.test/api/v3/responses");
    expect(body.input).toEqual([{ type: "message", role: "user", content: "only the new turn" }]);
    expect(body.previous_response_id).toBe("resp-1");
    expect(body.store).toBe(true);
    expect(body.caching).toEqual({ type: "enabled" });
    expect(result.metadata.responseId).toBe("resp-2");
    expect(result.metadata.previousResponseId).toBe("resp-1");
  });

  it("uses Responses text.format for structured output without caching", async () => {
    process.env.ARK_RESPONSES_API_URL = "https://example.test/api/v3/responses";
    const fetchMock = vi.fn(async () => jsonResponse({
      id: "resp-json",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ value: "ok" }) }] }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await completeStructured({
      modelClient: new ModelClientService(),
      name: "response_schema",
      schema: z.object({ value: z.string() }),
      apiStyle: "responses",
      cacheStrategy: "prefix",
      store: false,
      messages: [
        { role: "system", content: "stable" },
        { role: "user", content: "dynamic" },
      ],
    });

    const body = requestBody(fetchMock);
    expect(body.text).toMatchObject({ format: { type: "json_schema", name: "response_schema", strict: true } });
    expect(body.input).toEqual([
      { type: "message", role: "system", content: "stable" },
      { type: "message", role: "user", content: "dynamic" },
    ]);
    expect(body.previous_response_id).toBeUndefined();
    expect(body.caching).toBeUndefined();
  });

  it("sends image parts and JSON Schema in the same Chat Completions request", async () => {
    process.env.ARK_API_URL = "https://example.test/api/v3/chat/completions";
    const fetchMock = vi.fn(async () => jsonResponse({
      choices: [{ message: { content: JSON.stringify({ pass: true, level: "low", reason: "safe", types: ["none"] }) } }],
    }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new ModelClientService();

    await completeStructured({
      modelClient: service,
      name: "image_moderation",
      schema: z.object({ pass: z.boolean(), level: z.enum(["low", "medium", "high"]), reason: z.string(), types: z.array(z.string()) }),
      messages: [
        { role: "system", content: "review image" },
        { role: "user", content: [
          { type: "image_url", image_url: { url: "data:image/png;base64,dGVzdA==", detail: "high" } },
          { type: "text", text: "return structured review" },
        ] },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = requestBody(fetchMock);
    const messages = body.messages as Array<Record<string, unknown>>;
    expect((messages[1]?.content) as unknown[]).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "image_url" }),
      expect.objectContaining({ type: "text", text: "return structured review" }),
    ]));
    expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "image_moderation", strict: true } });
  });

  it("emits response ids and usage from a Responses stream", async () => {
    process.env.ARK_RESPONSES_API_URL = "https://example.test/api/v3/responses";
    const sse = [
      'event: response.created\ndata: {"type":"response.created","response":{"id":"resp-stream","status":"in_progress","expire_at":1800000000}}\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hello"}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp-stream","status":"completed","usage":{"input_tokens":12,"input_tokens_details":{"cached_tokens":8},"output_tokens":2,"total_tokens":14}}}\n\n',
      "data: [DONE]\n\n",
    ].join("");
    const fetchMock = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        controller.close();
      },
    }), { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);

    const events = [];
    for await (const event of new ModelClientService().streamWithMetadata({
      apiStyle: "responses",
      cacheStrategy: "session",
      store: true,
      messages: [{ role: "user", content: "hello" }],
    })) events.push(event);

    expect(events).toEqual([
      expect.objectContaining({ type: "created", metadata: expect.objectContaining({ responseId: "resp-stream" }) }),
      { type: "delta", text: "hello" },
      expect.objectContaining({
        type: "completed",
        metadata: expect.objectContaining({ responseId: "resp-stream", usage: expect.objectContaining({ cachedInputTokens: 8 }) }),
      }),
    ]);
  });

  it("streams structured generation stages and records stage TTFT, attempt, and output cap", async () => {
    process.env.ARK_RESPONSES_API_URL = "https://example.test/api/v3/responses";
    const sse = [
      'event: response.created\ndata: {"type":"response.created","response":{"id":"resp-stage","status":"in_progress"}}\n\n',
      `event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":${JSON.stringify(JSON.stringify({ value: "ok" }))}}\n\n`,
      'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp-stage","status":"completed","model":"doubao-seed-evolving","usage":{"input_tokens":20,"output_tokens":8,"output_tokens_details":{"reasoning_tokens":2},"total_tokens":28}}}\n\n',
      "data: [DONE]\n\n",
    ].join("");
    const fetchMock = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        controller.close();
      },
    }), { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);
    const callLogs = { log: vi.fn(async () => ({ id: "stage-log" })), attachResult: vi.fn(async () => ({ count: 1 })) };

    await completeStructured({
      modelClient: new ModelClientService(callLogs as never),
      name: "article_draft",
      schema: z.object({ value: z.string() }),
      telemetry: { scene: "direct_generate", stage: "article_draft", attempt: 1 },
      apiStyle: "responses",
      maxOutputTokens: 1200,
      messages: [{ role: "user", content: "return json" }],
    });

    expect(requestBody(fetchMock)).toMatchObject({ stream: true, max_output_tokens: 1200 });
    expect(callLogs.log).toHaveBeenCalledWith(expect.objectContaining({
      stage: "article_draft",
      attempt: 1,
      inputSummary: JSON.stringify([{ role: "user", content: "return json" }]),
      firstTokenLatencyMs: expect.any(Number),
      outputTokens: 8,
    }));
    expect(callLogs.attachResult).toHaveBeenCalledWith("stage-log", { value: "ok" }, { success: true });
  });

  it("keeps an interrupted Responses stream retryable instead of committing partial text", async () => {
    process.env.ARK_RESPONSES_API_URL = "https://example.test/api/v3/responses";
    const sse = [
      'event: response.created\ndata: {"type":"response.created","response":{"id":"resp-interrupted","status":"in_progress"}}\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"partial"}\n\n',
      "data: [DONE]\n\n",
    ].join("");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        controller.close();
      },
    }), { status: 200 })));

    const consume = async () => {
      for await (const _event of new ModelClientService().streamWithMetadata({
        apiStyle: "responses",
        store: true,
        messages: [{ role: "user", content: "hello" }],
      })) {
        // Consume the stream so its terminal status is validated.
      }
    };

    await expect(consume()).rejects.toMatchObject({ code: "UPSTREAM_INCOMPLETE_STREAM", retryable: true });
  });
});

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>) {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
