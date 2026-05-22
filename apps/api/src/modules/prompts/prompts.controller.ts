import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { PromptScene } from "@aicp/shared";
import { PromptsService } from "./prompts.service";

@Controller("prompts")
export class PromptsController {
  constructor(private readonly promptsService: PromptsService) {}

  @Get()
  list(@Query("scene") scene?: PromptScene) {
    return this.promptsService.list(scene);
  }

  @Get(":id")
  detail(@Param("id") id: string) {
    return this.promptsService.detail(id);
  }

  @Post()
  create(
    @Body()
    body: {
      name: string;
      scene: PromptScene;
      template: string;
      variables?: string[];
      model?: string;
      modelOptions?: Record<string, unknown>;
    }
  ) {
    return this.promptsService.create(body);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body()
    body: Partial<{
      name: string;
      template: string;
      variables: string[];
      model: string;
      modelOptions: Record<string, unknown>;
      status: "active" | "draft" | "disabled";
    }>
  ) {
    return this.promptsService.update(id, body);
  }
}
