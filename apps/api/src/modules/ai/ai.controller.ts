import { Body, Controller, Get, Post } from "@nestjs/common";
import type { AiGenerateRequest } from "@aicp/shared";
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
}
