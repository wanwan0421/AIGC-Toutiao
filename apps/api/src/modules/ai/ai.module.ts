import { Module } from "@nestjs/common";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";
import { AiCallLogService } from "./ai-call-log.service";
import { ContextBuilderService } from "./context-builder.service";
import { MemoryService } from "./memory.service";
import { ModelClientService } from "./model-client.service";
import { PromptTemplateService } from "./prompt-template.service";
import { DraftGeneratorAgent } from "./agents/draft-generator.agent";
import { IdeaAssistantAgent } from "./agents/idea-assistant.agent";
import { SelectionRewriterAgent } from "./agents/selection-rewriter.agent";
import { TitleAgent } from "./agents/title.agent";
import { CreativeChatSkill } from "./skills/creative-chat.skill";
import { DirectGenerateSkill } from "./skills/direct-generate.skill";
import { SelectionRewriteSkill } from "./skills/selection-rewrite.skill";
import { TitleGenerateSkill } from "./skills/title-generate.skill";

@Module({
  controllers: [AiController],
  providers: [
    AiService,
    AiCallLogService,
    ContextBuilderService,
    MemoryService,
    ModelClientService,
    PromptTemplateService,
    DraftGeneratorAgent,
    IdeaAssistantAgent,
    SelectionRewriterAgent,
    TitleAgent,
    CreativeChatSkill,
    DirectGenerateSkill,
    SelectionRewriteSkill,
    TitleGenerateSkill
  ]
})
export class AiModule {}
