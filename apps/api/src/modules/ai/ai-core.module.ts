import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";
import { AiCallLogService } from "./ai-call-log.service";
import { ComplianceRewriteAgent } from "./agents/compliance-rewrite.agent";
import { DraftGeneratorAgent } from "./agents/draft-generator.agent";
import { IdeaAssistantAgent } from "./agents/idea-assistant.agent";
import { QualityScoringAgent } from "./agents/quality-scoring.agent";
import { SafetyReviewAgent } from "./agents/safety-review.agent";
import { SelectionRewriterAgent } from "./agents/selection-rewriter.agent";
import { TitleAgent } from "./agents/title.agent";
import { ContextBuilderService } from "./context-builder.service";
import { ConversationArchiveService } from "./conversation-archive.service";
import { ImageGenerationService } from "./image-generation.service";
import { MemoryService } from "./memory.service";
import { ModelClientService } from "./model-client.service";
import { PromptTemplateService } from "./prompt-template.service";
import { SafetyResultMerger } from "./safety/safety-result-merger.service";
import { SafetyRuleEngine } from "./safety/safety-rule-engine.service";
import { SafetyRuleLoader } from "./safety/safety-rule-loader.service";
import { ContentQualitySkill } from "./skills/content-quality.skill";
import { CreativeAssistantSkill } from "./skills/creative-assistant.skill";
import { CreativeProductionSkill } from "./skills/creative-production.skill";
import { SafetyReviewSkill } from "./skills/safety-review.skill";

const providers = [
  AiCallLogService,
  ContextBuilderService,
  ConversationArchiveService,
  ImageGenerationService,
  MemoryService,
  ModelClientService,
  PromptTemplateService,
  SafetyRuleLoader,
  SafetyRuleEngine,
  SafetyResultMerger,
  DraftGeneratorAgent,
  IdeaAssistantAgent,
  SelectionRewriterAgent,
  TitleAgent,
  SafetyReviewAgent,
  QualityScoringAgent,
  ComplianceRewriteAgent,
  SafetyReviewSkill,
  ContentQualitySkill,
  CreativeAssistantSkill,
  CreativeProductionSkill,
];

@Module({
  imports: [StorageModule],
  providers,
  exports: providers,
})
export class AiCoreModule {}
