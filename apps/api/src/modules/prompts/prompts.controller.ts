import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { PromptScene, type UserProfileSummary } from "@aicp/shared";
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
    @CurrentUser() user: UserProfileSummary,
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
    return this.promptsService.update(user.id, id, body);
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
    return this.promptsService.createVersion(user.id, key, body);
  }

  @Post(":key/versions/:versionId/activate")
  activateVersion(
    @CurrentUser() user: UserProfileSummary,
    @Param("key") key: string,
    @Param("versionId") versionId: string
  ) {
    return this.promptsService.activateVersion(user.id, key, Number(versionId));
  }

  @Post(":key/render-preview")
  renderPreview(
    @CurrentUser() user: UserProfileSummary,
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
    return this.promptsService.renderPreview(user.id, key, body);
  }

  @Get(":key/test-cases")
  listTestCases(@Param("key") key: string) {
    return this.promptsService.listTestCases(key);
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
    const convertedBody = {
      name: body.name,
      inputVars: body.input,
      expected: typeof body.expectedOutput === "string" ? body.expectedOutput : "",
    };
    return this.promptsService.createTestCase(user.id, key, convertedBody);
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
    const convertedBody = {
      name: body.name,
      inputVars: body.input,
      expected: typeof body.expectedOutput === "string" ? body.expectedOutput : undefined,
    };
    return this.promptsService.updateTestCase(user.id, caseId, convertedBody);
  }

  @Delete(":key/test-cases/:caseId")
  deleteTestCase(@CurrentUser() user: UserProfileSummary, @Param("key") key: string, @Param("caseId") caseId: string) {
    return this.promptsService.deleteTestCase(user.id, caseId);
  }

  @Post(":key/eval-runs")
  runEval(
    @CurrentUser() user: UserProfileSummary,
    @Param("key") key: string,
    @Body() body: { versionId?: string; includeDisabled?: boolean; testCaseIds?: string[] }
  ) {
    return this.promptsService.runEvaluation(user.id, key, body);
  }

  @Get(":key/eval-runs/:runId")
  getEvalRun(@CurrentUser() user: UserProfileSummary, @Param("key") key: string, @Param("runId") runId: string) {
    return this.promptsService.getEvalRun(runId);
  }
}
