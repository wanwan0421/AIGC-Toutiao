import { BadRequestException, Injectable } from "@nestjs/common";
import type { CreativeChatMessage, CreativeChatRequest } from "@aicp/shared";
import { MemoryService } from "./memory.service";

@Injectable()
export class ContextBuilderService {
  constructor(private readonly memoryService: MemoryService) {}

  // 构建创作助手对话的上下文，包括解析用户输入、获取对话历史、整理当前状态等，为后续的 AI 处理提供全面的信息支持
  async buildCreativeChatContext(request: CreativeChatRequest) {
    const userId = await this.resolveUserId(request.userId);
    const contentId = request.contentId ?? "new-content";
    const conversationId = request.conversationId ?? this.memoryService.createConversationId();
    const history = await this.memoryService.getShortTermMessages({ userId, contentId, conversationId });

    return {
      userId,
      contentId,
      persistenceContentId: request.contentId ?? null,
      conversationId,
      history,
      currentTitle: request.currentTitle ?? "",
      currentBody: request.currentBody ?? "",
      selectedText: request.selectedText ?? "",
      bodySummary: this.summarize(request.currentBody ?? ""),
    };
  }

  formatHistory(history: CreativeChatMessage[]) {
    return history.map((message) => `${message.role === "user" ? "User" : "AI"}: ${message.content}`).join("\n");
  }

  summarize(value: string, maxLength = 600) {
    const compact = value.replace(/\s+/g, " ").trim();
    if (compact.length <= maxLength) return compact;
    return `${compact.slice(0, maxLength)}...`;
  }

  async resolveUserId(userId?: string) {
    if (userId) return userId;
    throw new BadRequestException("authenticated user is required for creative chat context");
  }
}
