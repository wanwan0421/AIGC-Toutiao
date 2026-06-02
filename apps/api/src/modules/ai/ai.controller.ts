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
import { ContentWorkflowEngine } from "../workflow/content-workflow.engine";

@UseGuards(AuthGuard)
@Controller("ai")
export class AiController {
  constructor(private readonly workflow: ContentWorkflowEngine) {}

  @Post("generate")
  generate(@CurrentUser() user: UserProfileSummary, @Body() body: AiGenerateRequest & { audience?: string }) {
    return this.workflow.generate({ ...body, userId: user.id });
  }

  @Post("audit")
  audit(@Body() body: { title: string; body: string }) {
    return this.workflow.auditText(body);
  }

  @Post("score")
  score(@Body() body: { title: string; body: string }) {
    return this.workflow.scoreText(body);
  }

  @Post("rewrite")
  rewrite(@Body() body: { title: string; body: string; reasons?: string[] }) {
    return this.workflow.rewriteText(body);
  }

  @Get("logs")
  logs() {
    return this.workflow.logs();
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
      for await (const event of this.workflow.streamCreativeChat({ ...body, userId: user.id })) {
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
    return this.workflow.directGenerate({ ...body, userId: user.id });
  }

  @Post("creative/titles")
  generateTitles(@Body() body: TitleGenerateRequest) {
    return this.workflow.generateTitles(body);
  }

  @Post("creative/selection/rewrite")
  rewriteSelection(@Body() body: SelectionRewriteRequest) {
    return this.workflow.rewriteSelection(body);
  }

  @Get("creative/image/config")
  creativeImageConfigStatus() {
    return this.workflow.creativeImageConfigStatus();
  }

  @Get("creative/conversations")
  creativeConversations(@CurrentUser() user: UserProfileSummary, @Query("contentId") contentId?: string) {
    if (!contentId) return [];
    return this.workflow.creativeConversations(contentId, user.id);
  }

  @Patch("creative/conversations/:id/attach")
  attachCreativeConversation(
    @CurrentUser() user: UserProfileSummary,
    @Param("id") id: string,
    @Body() body: { contentId: string }
  ) {
    return this.workflow.attachCreativeConversation(id, { ...body, userId: user.id });
  }

}
