import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";
import { AiCallLogService } from "./ai-call-log.service";
import { ComplianceRewriteAgent } from "./agents/compliance-rewrite.agent";
import { ContentDraftPipeline } from "./application/content-draft.pipeline";
import { IdeaAssistantAgent } from "./agents/idea-assistant.agent";
import { QualityScoringAgent } from "./agents/quality-scoring.agent";
import { SafetyReviewAgent } from "./agents/safety-review.agent";
import { SelectionRewriterAgent } from "./agents/selection-rewriter.agent";
import { SkillRouterAgent } from "./agents/skill-router.agent";
import { TitleAgent } from "./agents/title.agent";
import { ContextBuilderService } from "./context-builder.service";
import { ConversationArchiveService } from "./conversation-archive.service";
import { ConversationCompactionService } from "./conversation-compaction.service";
import { ConversationSessionService } from "./conversation-session.service";
import { ImageGenerationService } from "./image-generation.service";
import { MemoryService } from "./memory.service";
import { ModelClientService } from "./model-client.service";
import { PromptTemplateService } from "./prompt-template.service";
import { SafetyResultMerger } from "./safety/safety-result-merger.service";
import { SafetyRuleEngine } from "./safety/safety-rule-engine.service";
import { SafetyRuleLoader } from "./safety/safety-rule-loader.service";
import { GenerateContentUseCase } from "./application/generate-content.use-case";
import { SkillRegistryService } from "./skills-runtime/skill-registry.service";
import { CreativeAssistantUseCase } from "./application/creative-assistant.use-case";
import { ContentSafetyUseCase } from "./application/content-safety.use-case";
import { ImageModerationService } from "../assets/image-moderation.service";
import { ToolRegistryService } from "./tools/tool-registry.service";
import { ToolOrchestratorService } from "./tools/tool-orchestrator.service";
import { ContentProductionResourceOrchestrator } from "./application/content-production-resource.orchestrator";

const providers = [
  AiCallLogService,
  ContextBuilderService,
  ConversationArchiveService,
  ConversationCompactionService,
  ConversationSessionService,
  ImageGenerationService,
  MemoryService,
  ModelClientService,
  PromptTemplateService,
  SafetyRuleLoader,
  SafetyRuleEngine,
  SafetyResultMerger,
  ContentDraftPipeline,
  ContentProductionResourceOrchestrator,
  IdeaAssistantAgent,
  SkillRouterAgent,
  SelectionRewriterAgent,
  TitleAgent,
  SafetyReviewAgent,
  QualityScoringAgent,
  ComplianceRewriteAgent,
  SkillRegistryService,
  GenerateContentUseCase,
  ContentSafetyUseCase,
  CreativeAssistantUseCase,
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
