import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { PromptScene, type PromptEvalRunRequest, type UserProfileSummary } from "@aicp/shared";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { PromptsService } from "./prompts.service";

@UseGuards(AuthGuard)
@Controller("prompts")
export class PromptsController {
  constructor(private readonly promptsService: PromptsService) {}

  @Get()
  list(@Query("scene") scene?: PromptScene) {
    return this.promptsService.list(scene);
  }

  @Get("definitions")
  definitions(@Query("scene") scene?: PromptScene) {
    return this.promptsService.listDefinitions(scene);
  }

  @Get(":id")
  detail(@Param("id") id: string) {
    return this.promptsService.detail(id);
  }

  @Post()
  create(
    @CurrentUser() user: UserProfileSummary,
    @Body()
    body: {
      name: string;
      scene: PromptScene;
      template: string;
      variables?: string[];
      model?: string;
      modelOptions?: Record<string, unknown>;
      outputSchema?: Record<string, unknown>;
      description?: string;
      changeNote?: string;
    }
  ) {
    return this.promptsService.create(user.id, body);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body()
    body: Partial<{
      name: string;
      description: string;
      scene: PromptScene;
      template: string;
      variables: string[];
      model: string;
      modelOptions: Record<string, unknown>;
      outputSchema: Record<string, unknown>;
      changeNote: string;
      status: "active" | "draft" | "disabled";
    }>
  ) {
    return this.promptsService.update(id, body);
  }

  @Get(":key/versions")
  versions(@Param("key") key: string) {
    return this.promptsService.listVersions(key);
  }

  @Post(":key/versions")
  createVersion(
    @CurrentUser() user: UserProfileSummary,
    @Param("key") key: string,
    @Body()
    body: {
      template: string;
      variables?: string[];
      model?: string;
      modelOptions?: Record<string, unknown>;
      outputSchema?: Record<string, unknown>;
      changeNote?: string;
      status?: "active" | "draft" | "disabled";
    }
  ) {
    return this.promptsService.createVersion(key, user.id, body);
  }

  @Post(":key/versions/:versionId/activate")
  activateVersion(@Param("key") key: string, @Param("versionId") versionId: string) {
    return this.promptsService.activateVersion(key, versionId);
  }

  @Post(":key/render-preview")
  renderPreview(
    @Param("key") key: string,
    @Body()
    body: {
      input?: Record<string, unknown>;
      template?: string;
      variables?: string[];
      model?: string;
      modelOptions?: Record<string, unknown>;
      outputSchema?: Record<string, unknown>;
    }
  ) {
    return this.promptsService.renderPreview(key, body);
  }

  @Get(":key/test-cases")
  listTestCases(
    @CurrentUser() user: UserProfileSummary,
    @Param("key") key: string,
    @Query("limit") limit?: string,
    @Query("sample") sample?: string
  ) {
    return this.promptsService.listTestCases(key, user.id, {
      limit: limit ? Number.parseInt(limit, 10) : undefined,
      sample,
    });
  }

  @Post(":key/test-cases")
  createTestCase(
    @CurrentUser() user: UserProfileSummary,
    @Param("key") key: string,
    @Body()
    body: {
      name: string;
      input: Record<string, unknown>;
      expectedOutput?: unknown;
      assertions?: Record<string, unknown>;
      enabled?: boolean;
    }
  ) {
    return this.promptsService.createTestCase(key, user.id, body);
  }

  @Patch(":key/test-cases/:caseId")
  updateTestCase(
    @CurrentUser() user: UserProfileSummary,
    @Param("key") key: string,
    @Param("caseId") caseId: string,
    @Body()
    body: Partial<{
      name: string;
      input: Record<string, unknown>;
      expectedOutput: unknown;
      assertions: Record<string, unknown>;
      enabled: boolean;
    }>
  ) {
    return this.promptsService.updateTestCase(key, caseId, user.id, body);
  }

  @Delete(":key/test-cases/:caseId")
  deleteTestCase(@CurrentUser() user: UserProfileSummary, @Param("key") key: string, @Param("caseId") caseId: string) {
    return this.promptsService.deleteTestCase(key, caseId, user.id);
  }

  @Post(":key/eval-runs")
  runEval(
    @Param("key") key: string,
    @Body() body: PromptEvalRunRequest
  ) {
    return this.promptsService.runEval(key, body);
  }

  @Get(":key/eval-runs/compare")
  compareEvalRuns(
    @Param("key") key: string,
    @Query("baselineRunId") baselineRunId: string,
    @Query("candidateRunId") candidateRunId: string
  ) {
    return this.promptsService.compareEvalRuns(key, baselineRunId, candidateRunId);
  }

  @Get(":key/eval-runs/:runId")
  getEvalRun(@Param("key") key: string, @Param("runId") runId: string) {
    return this.promptsService.getEvalRun(key, runId);
  }
}
