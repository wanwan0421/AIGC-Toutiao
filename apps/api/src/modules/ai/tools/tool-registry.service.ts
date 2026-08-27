import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { AppError } from "../../../common/app-error";

export type ToolContext = { userId: string; aiJobId?: string; conversationId?: string; contentId?: string; signal?: AbortSignal };
export type ToolDefinition<T extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  description: string;
  schema: T;
  execute: (args: z.output<T>, context: ToolContext) => Promise<unknown>;
};

@Injectable()
export class ToolRegistryService {
  private readonly tools = new Map<string, ToolDefinition>();

  register(definition: ToolDefinition) {
    if (this.tools.has(definition.name)) throw new Error(`duplicate tool: ${definition.name}`);
    this.tools.set(definition.name, definition);
  }

  modelTools() {
    return [...this.tools.values()].map((tool) => ({
      type: "function" as const,
      function: { name: tool.name, description: tool.description, parameters: z.toJSONSchema(tool.schema) },
    }));
  }

  async execute(name: string, rawArguments: unknown, context: ToolContext) {
    const tool = this.tools.get(name);
    if (!tool) throw new AppError({ code: "UNKNOWN_TOOL", message: "模型请求了不支持的工具", statusCode: 422, retryable: false });
    const parsed = tool.schema.safeParse(rawArguments);
    if (!parsed.success) throw new AppError({ code: "INVALID_TOOL_ARGUMENTS", message: "工具参数校验失败", statusCode: 422, retryable: false });
    return tool.execute(parsed.data, context);
  }
}
