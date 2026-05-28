import { Injectable } from "@nestjs/common";
import type { CreativeChatMessage, CreativeChatRequest } from "@aicp/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { DEFAULT_USER_EMAIL } from "../../common/defaults";
import { MemoryService } from "./memory.service";

@Injectable()
export class ContextBuilderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memoryService: MemoryService
  ) {}

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
    return history
      .map((message) => `${message.role === "user" ? "用户" : "AI"}：${message.content}`)
      .join("\n");
  }

  summarize(value: string, maxLength = 600) {
    const compact = value.replace(/\s+/g, " ").trim();
    if (compact.length <= maxLength) return compact;
    return `${compact.slice(0, maxLength)}...`;
  }

  async resolveUserId(userId?: string) {
    if (userId) return userId;
    const user = await this.prisma.user.findFirst({ where: { email: DEFAULT_USER_EMAIL } }).catch(() => null);
    return user?.id ?? "anonymous-user";
  }
}
