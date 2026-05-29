import { Injectable } from "@nestjs/common";
import type { CreativeChatRequest, DirectGenerateRequest, SelectionRewriteRequest, TitleGenerateRequest } from "@aicp/shared";
import { CreativeAssistantSkill } from "./skills/creative-assistant.skill";
import { CreativeProductionSkill } from "./skills/creative-production.skill";

@Injectable()
export class CreativeOrchestratorService {
  constructor(
    private readonly assistantSkill: CreativeAssistantSkill,
    private readonly productionSkill: CreativeProductionSkill
  ) {}

  streamCreativeChat(request: CreativeChatRequest) {
    return this.assistantSkill.streamChat(request);
  }

  directGenerate(request: DirectGenerateRequest) {
    return this.productionSkill.directGenerate(request);
  }

  generateTitles(request: TitleGenerateRequest) {
    return this.assistantSkill.generateTitles(request);
  }

  rewriteSelection(request: SelectionRewriteRequest) {
    return this.assistantSkill.rewriteSelection(request);
  }

  imageConfigStatus() {
    return this.productionSkill.imageConfigStatus();
  }
}
