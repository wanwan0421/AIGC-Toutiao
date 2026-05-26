import { Body, Controller, Get, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import type { AiGenerateRequest, CreativeChatRequest, DirectGenerateRequest, SelectionRewriteRequest, TitleGenerateRequest } from "@aicp/shared";
import { AiService } from "./ai.service";

@Controller("ai")
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post("generate")
  generate(@Body() body: AiGenerateRequest & { audience?: string }) {
    return this.aiService.generate(body);
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
  async streamCreativeChat(@Body() body: CreativeChatRequest, @Res() response: Response) {
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders?.();

    try {
      for await (const event of this.aiService.streamCreativeChat(body)) {
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
  directGenerate(@Body() body: DirectGenerateRequest) {
    return this.aiService.directGenerate(body);
  }

  @Post("creative/titles")
  generateTitles(@Body() body: TitleGenerateRequest) {
    return this.aiService.generateTitles(body);
  }

  @Post("creative/selection/rewrite")
  rewriteSelection(@Body() body: SelectionRewriteRequest) {
    return this.aiService.rewriteSelection(body);
  }
}
