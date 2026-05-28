import { Module } from "@nestjs/common";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";
import { AiCallLogService } from "./ai-call-log.service";
import { ContextBuilderService } from "./context-builder.service";
import { ConversationArchiveService } from "./conversation-archive.service";
import { ImageGenerationService } from "./image-generation.service";
import { MemoryService } from "./memory.service";
import { ModelClientService } from "./model-client.service";
import { PromptTemplateService } from "./prompt-template.service";
import { DraftGeneratorAgent } from "./agents/draft-generator.agent";
import { IdeaAssistantAgent } from "./agents/idea-assistant.agent";
import { SelectionRewriterAgent } from "./agents/selection-rewriter.agent";
import { TitleAgent } from "./agents/title.agent";
import { CreativeAssistantSkill } from "./skills/creative-assistant.skill";
import { CreativeProductionSkill } from "./skills/creative-production.skill";

@Module({
  controllers: [AiController],
  providers: [
    AiService,
    AiCallLogService,
    ContextBuilderService,
    ConversationArchiveService,
    ImageGenerationService,
    MemoryService,
    ModelClientService,
    PromptTemplateService,
    DraftGeneratorAgent,
    IdeaAssistantAgent,
    SelectionRewriterAgent,
    TitleAgent,
    CreativeAssistantSkill,
    CreativeProductionSkill
  ]
})
export class AiModule {}
