import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";
import { AiCallLogService } from "./ai-call-log.service";
import { ComplianceRewriteAgent } from "./agents/compliance-rewrite.agent";
import { DraftGeneratorAgent } from "./agents/draft-generator.agent";
import { IdeaAssistantAgent } from "./agents/idea-assistant.agent";
import { QualityScoringAgent } from "./agents/quality-scoring.agent";
import { SafetyReviewAgent } from "./agents/safety-review.agent";
import { SelectionRewriterAgent } from "./agents/selection-rewriter.agent";
import { SkillRouterAgent } from "./agents/skill-router.agent";
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
import { SkillExecutorService } from "./skills-runtime/skill-executor.service";
import { SkillRegistryService } from "./skills-runtime/skill-registry.service";
import { ContentQualityCapability } from "./capabilities/content-quality.capability";
import { CreativeAssistantCapability } from "./capabilities/creative-assistant.capability";
import { CreativeProductionCapability } from "./capabilities/creative-production.capability";
import { SafetyReviewCapability } from "./capabilities/safety-review.capability";
import { ImageModerationService } from "../assets/image-moderation.service";
import { ToolRegistryService } from "./tools/tool-registry.service";
import { ToolOrchestratorService } from "./tools/tool-orchestrator.service";

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
  SkillRouterAgent,
  SelectionRewriterAgent,
  TitleAgent,
  SafetyReviewAgent,
  QualityScoringAgent,
  ComplianceRewriteAgent,
  SkillRegistryService,
  SkillExecutorService,
  SafetyReviewCapability,
  ContentQualityCapability,
  CreativeAssistantCapability,
  CreativeProductionCapability,
  ImageModerationService,
  ToolRegistryService,
  ToolOrchestratorService,
];

@Module({
  imports: [StorageModule],
  providers,
  exports: providers,
})
export class AiCoreModule {}
