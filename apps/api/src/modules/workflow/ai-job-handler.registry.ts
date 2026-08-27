import { Injectable } from "@nestjs/common";
import { AiJobType } from "@aicp/shared";
import { AppError } from "../../common/app-error";

export type AiJobExecutionContext = {
  jobId: string;
  runToken: string;
  type: `${AiJobType}`;
  payload: Record<string, unknown>;
  userId: string;
  contentId?: string;
  conversationId?: string;
  signal?: AbortSignal;
};

export type AiJobHandler = (context: AiJobExecutionContext) => Promise<unknown>;

@Injectable()
export class AiJobHandlerRegistry {
  private readonly handlers = new Map<`${AiJobType}`, AiJobHandler>();

  register(type: `${AiJobType}`, handler: AiJobHandler) {
    if (this.handlers.has(type)) throw new Error(`AI job handler already registered: ${type}`);
    this.handlers.set(type, handler);
  }

  execute(context: AiJobExecutionContext) {
    const handler = this.handlers.get(context.type);
    if (!handler) {
      throw new AppError({
        code: "UNSUPPORTED_AI_JOB_TYPE",
        message: `Unsupported AI job type: ${context.type}`,
        statusCode: 422,
        retryable: false,
      });
    }
    return handler(context);
  }
}
