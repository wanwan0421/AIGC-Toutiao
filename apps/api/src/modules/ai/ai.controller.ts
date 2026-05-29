import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import type {
  AiGenerateRequest,
  CreativeChatRequest,
  DirectGenerateRequest,
  SelectionRewriteRequest,
  TitleGenerateRequest,
  UserProfileSummary
} from "@aicp/shared";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { AiService } from "./ai.service";

@UseGuards(AuthGuard)
@Controller("ai")
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post("generate")
  generate(@CurrentUser() user: UserProfileSummary, @Body() body: AiGenerateRequest & { audience?: string }) {
    return this.aiService.generate({ ...body, userId: user.id });
  }

  @Post("audit")
  audit(@Body() body: { title: string; body: string }) {
    return this.aiService.audit(body);
  }

  @Post("score")
  score(@Body() body: { title: string; body: string }) {
    return this.aiService.score(body);
  }

  @Post("rewrite")
  rewrite(@Body() body: { title: string; body: string; reasons?: string[] }) {
    return this.aiService.rewrite(body);
  }

  @Get("logs")
  logs() {
    return this.aiService.logs();
  }

  @Post("creative/chat/stream")
  async streamCreativeChat(
    @CurrentUser() user: UserProfileSummary,
    @Body() body: CreativeChatRequest,
    @Res() response: Response
  ) {
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders?.();

    try {
      for await (const event of this.aiService.streamCreativeChat({ ...body, userId: user.id })) {
        response.write(`event: ${event.type}\n`);
        response.write(`data: ${JSON.stringify(event.data)}\n\n`);
      }
    } catch (error) {
      response.write("event: error\n");
      response.write(`data: ${JSON.stringify({ message: (error as Error).message })}\n\n`);
    } finally {
      response.end();
    }
  }

  @Post("creative/direct-generate")
  directGenerate(@CurrentUser() user: UserProfileSummary, @Body() body: DirectGenerateRequest) {
    return this.aiService.directGenerate({ ...body, userId: user.id });
  }

  @Post("creative/titles")
  generateTitles(@Body() body: TitleGenerateRequest) {
    return this.aiService.generateTitles(body);
  }

  @Post("creative/selection/rewrite")
  rewriteSelection(@Body() body: SelectionRewriteRequest) {
    return this.aiService.rewriteSelection(body);
  }

  @Get("creative/image/config")
  creativeImageConfigStatus() {
    return this.aiService.creativeImageConfigStatus();
  }

  @Get("creative/conversations")
  creativeConversations(@CurrentUser() user: UserProfileSummary, @Query("contentId") contentId?: string) {
    if (!contentId) return [];
    return this.aiService.creativeConversations(contentId, user.id);
  }

  @Patch("creative/conversations/:id/attach")
  attachCreativeConversation(
    @CurrentUser() user: UserProfileSummary,
    @Param("id") id: string,
    @Body() body: { contentId: string }
  ) {
    return this.aiService.attachCreativeConversation(id, { ...body, userId: user.id });
  }
}
