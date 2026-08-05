import { Injectable } from "@nestjs/common";
import { AppError, throwIfAborted } from "../../../common/app-error";
import { ModelClientService, type ModelMessage } from "../model-client.service";
import { ToolRegistryService, type ToolContext } from "./tool-registry.service";

@Injectable()
export class ToolOrchestratorService {
  constructor(private readonly model: ModelClientService, private readonly registry: ToolRegistryService) {}

  async run(messages: ModelMessage[], context: ToolContext, maxRounds = 6) {
    const seen = new Set<string>();
    for (let round = 0; round < maxRounds; round += 1) {
      throwIfAborted(context.signal);
      const response = await this.model.completeWithTools({ messages, tools: this.registry.modelTools(), signal: context.signal });
      if (!response.toolCalls.length) return response.text;
      messages.push({ role: "assistant", content: response.text, tool_calls: response.toolCalls });
      for (const call of response.toolCalls) {
        if (seen.has(call.id)) throw new AppError({ code: "DUPLICATE_TOOL_CALL", message: "检测到重复工具调用", statusCode: 422, retryable: false });
        seen.add(call.id);
        let args: unknown;
        try { args = JSON.parse(call.function.arguments); } catch { throw new AppError({ code: "INVALID_TOOL_ARGUMENTS", message: "工具参数不是合法 JSON", statusCode: 422, retryable: false }); }
        const result = await this.registry.execute(call.function.name, args, context);
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result ?? null) });
      }
    }
    throw new AppError({ code: "TOOL_ROUND_LIMIT", message: "工具调用轮数超过限制", statusCode: 422, retryable: false });
  }
}
