import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  PromptScene,
  type PromptDefinitionSummary,
  type PromptEvalRunSummary,
  type PromptRenderPreviewResult,
  type PromptTestCaseSummary,
  type PromptValidationIssue,
  type PromptVersionSummary,
} from "@aicp/shared";
import { Prisma } from "@prisma/client";
import { toApiPromptScene, toDbPromptScene } from "../../common/prisma-mappers";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { RedisService } from "../../infra/redis/redis.service";

type DefinitionWithActiveVersion = Prisma.PromptDefinitionGetPayload<{ include: { activeVersion: true } }>;
type VersionRecord = Prisma.PromptVersionGetPayload<Record<string, never>>;
type TestCaseRecord = Prisma.PromptTestCaseGetPayload<Record<string, never>>;
type EvalRunWithResults = Prisma.PromptEvalRunGetPayload<{ include: { results: true } }>;

type VersionInput = {
  template: string;
  variables?: string[];
  model?: string;
  modelOptions?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  changeNote?: string;
  status?: "active" | "draft" | "disabled";
};

@Injectable()
export class PromptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService
  ) {}

  async list(scene?: PromptScene) {
    const cacheKey = `prompts:v2:list:${scene ?? "all"}`;
    const cached = await this.redisService.getClient().get(cacheKey).catch(() => null);
    if (cached) {
      return JSON.parse(cached);
    }
    
    const items = await this.prisma.promptDefinition.findMany({
      where: scene ? { scene: toDbPromptScene(scene) } : undefined,
      include: { activeVersion: true },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    });
    const result = items.map((item) => this.toLegacyPromptSummary(item));
    await this.redisService.getClient().setex(cacheKey, 300, JSON.stringify(result)).catch(() => undefined);
    return result;
  }

  async listDefinitions(scene?: PromptScene): Promise<PromptDefinitionSummary[]> {
    const cacheKey = `prompts:v2:definitions:${scene ?? "all"}`;
    const cached = await this.redisService.getClient().get(cacheKey).catch(() => null);
    if (cached) {
      return JSON.parse(cached);
    }
    
    const items = await this.prisma.promptDefinition.findMany({
      where: scene ? { scene: toDbPromptScene(scene) } : undefined,
      include: { activeVersion: true },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    });
    const result = items.map((item) => this.toDefinitionSummary(item));
    await this.redisService.getClient().setex(cacheKey, 300, JSON.stringify(result)).catch(() => undefined);
    return result;
  }

  async detail(idOrKey: string) {
    const definition = await this.getDefinition(idOrKey);
    return this.toLegacyPromptSummary(definition);
  }

  async create(
    userId: string,
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
    if (!Object.values(PromptScene).includes(body.scene)) {
      throw new BadRequestException("invalid prompt scene");
    }

    const key = this.normalizeKey(body.name);
    const definition = await this.prisma.promptDefinition.create({
      data: {
        key,
        scene: toDbPromptScene(body.scene),
        displayName: body.name.trim(),
        description: body.description,
        status: "draft",
        creatorId: userId,
      },
    });
    const version = await this.createVersionRecord(definition.id, userId, {
      template: body.template,
      variables: body.variables,
      model: body.model ?? this.defaultModel(),
      modelOptions: body.modelOptions ?? { temperature: 0.7 },
      outputSchema: body.outputSchema,
      changeNote: body.changeNote ?? "创建初始版本",
      status: "draft",
    });

    const withVersion = await this.prisma.promptDefinition.update({
      where: { id: definition.id },
      data: { activeVersionId: version.id },
      include: { activeVersion: true },
    });
    return this.toLegacyPromptSummary(withVersion);
  }

  async update(
    idOrKey: string,
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
    const definition = await this.getDefinition(idOrKey);
    const hasVersionChanges =
      body.template !== undefined ||
      body.variables !== undefined ||
      body.model !== undefined ||
      body.modelOptions !== undefined ||
      body.outputSchema !== undefined;

    if (body.name !== undefined || body.description !== undefined || body.scene !== undefined || body.status !== undefined) {
      await this.prisma.promptDefinition.update({
        where: { id: definition.id },
        data: {
          displayName: body.name,
          description: body.description,
          scene: body.scene ? toDbPromptScene(body.scene) : undefined,
          status: body.status && body.status !== "active" ? body.status : undefined,
        },
      });
    }

    if (hasVersionChanges) {
      const base = definition.activeVersion ?? (await this.latestVersion(definition.id));
      const version = await this.createVersionRecord(definition.id, undefined, {
        template: body.template ?? base?.template ?? "",
        variables: body.variables ?? this.jsonStringArray(base?.variables),
        model: body.model ?? base?.model ?? this.defaultModel(),
        modelOptions: body.modelOptions ?? this.jsonObject(base?.modelOptions) ?? { temperature: 0.7 },
        outputSchema: body.outputSchema ?? this.jsonObject(base?.outputSchema) ?? undefined,
        changeNote: body.changeNote ?? "后台编辑保存新版本",
        status: body.status === "active" ? "active" : "draft",
      });
      if (body.status === "active") {
        await this.activateVersion(definition.key, version.id);
      }
    } else if (body.status === "active") {
      const active = definition.activeVersion ?? (await this.latestVersion(definition.id));
      if (active) await this.activateVersion(definition.key, active.id);
    }

    return this.detail(definition.id);
  }

  async listVersions(idOrKey: string): Promise<PromptVersionSummary[]> {
    const definition = await this.getDefinition(idOrKey);
    const versions = await this.prisma.promptVersion.findMany({
      where: { definitionId: definition.id },
      orderBy: { version: "desc" },
    });
    return versions.map((item) => this.toVersionSummary(item));
  }

  async createVersion(idOrKey: string, userId: string, body: VersionInput): Promise<PromptVersionSummary> {
    const definition = await this.getDefinition(idOrKey);
    const version = await this.createVersionRecord(definition.id, userId, {
      ...body,
      model: body.model ?? this.defaultModel(),
      modelOptions: body.modelOptions ?? { temperature: 0.7 },
    });
    if (body.status === "active") {
      await this.activateVersion(definition.key, version.id);
    }
    return this.toVersionSummary(version);
  }

  async activateVersion(idOrKey: string, versionId: string): Promise<PromptDefinitionSummary> {
    const definition = await this.getDefinition(idOrKey);
    const version = await this.prisma.promptVersion.findFirst({ where: { id: versionId, definitionId: definition.id } });
    if (!version) {
      throw new NotFoundException("prompt version not found");
    }

    await this.prisma.$transaction([
      this.prisma.promptVersion.updateMany({
        where: { definitionId: definition.id, status: "active", id: { not: version.id } },
        data: { status: "archived" },
      }),
      this.prisma.promptVersion.update({ where: { id: version.id }, data: { status: "active" } }),
      this.prisma.promptDefinition.update({
        where: { id: definition.id },
        data: { activeVersionId: version.id, status: "active" },
      }),
    ]);

    const updated = await this.getDefinition(definition.id);
    return this.toDefinitionSummary(updated);
  }

  async renderPreview(
    idOrKey: string,
    body: {
      input?: Record<string, unknown>;
      template?: string;
      variables?: string[];
      model?: string;
      modelOptions?: Record<string, unknown>;
      outputSchema?: Record<string, unknown>;
    }
  ): Promise<PromptRenderPreviewResult> {
    const definition = await this.getDefinition(idOrKey);
    const version = definition.activeVersion ?? (await this.latestVersion(definition.id));
    if (!version && !body.template) {
      throw new NotFoundException("prompt version not found");
    }

    const template = body.template ?? version?.template ?? "";
    const variables = this.extractVariables(template);
    const declaredVariables = body.variables ?? variables;
    const input = body.input ?? {};
    const issues = this.validateTemplate(template, declaredVariables, input);
    return {
      prompt: this.interpolate(template, input),
      variables,
      declaredVariables,
      inputKeys: this.flattenObjectKeys(input),
      issues,
      model: body.model ?? version?.model ?? null,
      modelOptions: body.modelOptions ?? this.jsonObject(version?.modelOptions),
      outputSchema: body.outputSchema ?? this.jsonObject(version?.outputSchema),
    };
  }

  async listTestCases(idOrKey: string): Promise<PromptTestCaseSummary[]> {
    const definition = await this.getDefinition(idOrKey);
    const items = await this.prisma.promptTestCase.findMany({
      where: { definitionId: definition.id },
      orderBy: { updatedAt: "desc" },
    });
    return items.map((item) => this.toTestCaseSummary(item));
  }

  async createTestCase(
    idOrKey: string,
    body: {
      name: string;
      input: Record<string, unknown>;
      expectedOutput?: unknown;
      assertions?: Record<string, unknown>;
      enabled?: boolean;
    }
  ): Promise<PromptTestCaseSummary> {
    const definition = await this.getDefinition(idOrKey);
    const item = await this.prisma.promptTestCase.create({
      data: {
        definitionId: definition.id,
        name: body.name.trim() || "未命名测试用例",
        input: this.toJsonInput(body.input),
        expectedOutput: this.toJsonInputOrUndefined(body.expectedOutput),
        assertions: this.toJsonInputOrUndefined(body.assertions),
        enabled: body.enabled ?? true,
      },
    });
    return this.toTestCaseSummary(item);
  }

  async updateTestCase(
    idOrKey: string,
    caseId: string,
    body: Partial<{
      name: string;
      input: Record<string, unknown>;
      expectedOutput: unknown;
      assertions: Record<string, unknown>;
      enabled: boolean;
    }>
  ): Promise<PromptTestCaseSummary> {
    const definition = await this.getDefinition(idOrKey);
    const current = await this.prisma.promptTestCase.findFirst({ where: { id: caseId, definitionId: definition.id } });
    if (!current) throw new NotFoundException("prompt test case not found");

    const item = await this.prisma.promptTestCase.update({
      where: { id: caseId },
      data: {
        name: body.name,
        input: this.toJsonInputOrUndefined(body.input),
        expectedOutput: this.toJsonInputOrUndefined(body.expectedOutput),
        assertions: this.toJsonInputOrUndefined(body.assertions),
        enabled: body.enabled,
      },
    });
    return this.toTestCaseSummary(item);
  }

  async deleteTestCase(idOrKey: string, caseId: string) {
    const definition = await this.getDefinition(idOrKey);
    const current = await this.prisma.promptTestCase.findFirst({ where: { id: caseId, definitionId: definition.id } });
    if (!current) throw new NotFoundException("prompt test case not found");
    await this.prisma.promptTestCase.delete({ where: { id: caseId } });
    return { ok: true, id: caseId };
  }

  async runEval(idOrKey: string, body: { versionId?: string; includeDisabled?: boolean } = {}): Promise<PromptEvalRunSummary> {
    const definition = await this.getDefinition(idOrKey);
    const version = body.versionId
      ? await this.prisma.promptVersion.findFirst({ where: { id: body.versionId, definitionId: definition.id } })
      : definition.activeVersion ?? (await this.latestVersion(definition.id));
    if (!version) throw new NotFoundException("prompt version not found");

    const testCases = await this.prisma.promptTestCase.findMany({
      where: { definitionId: definition.id, enabled: body.includeDisabled ? undefined : true },
      orderBy: { updatedAt: "desc" },
    });
    const run = await this.prisma.promptEvalRun.create({
      data: {
        definitionId: definition.id,
        versionId: version.id,
        mode: "dry_run",
        status: "running",
        total: testCases.length,
      },
    });

    let passed = 0;
    let failed = 0;
    for (const testCase of testCases) {
      const startedAt = Date.now();
      const input = this.jsonObject(testCase.input) ?? {};
      const renderedPrompt = this.interpolate(version.template, input);
      const issues = this.validateTemplate(version.template, this.jsonStringArray(version.variables), input);
      const assertionError = this.evaluateAssertions(renderedPrompt, testCase.assertions);
      const hasError = issues.some((item) => item.severity === "error") || Boolean(assertionError);
      if (hasError) failed += 1;
      else passed += 1;

      await this.prisma.promptEvalResult.create({
        data: {
          runId: run.id,
          testCaseId: testCase.id,
          status: hasError ? "failed" : "passed",
          input: this.toJsonInput(input),
          output: this.toJsonInput({
            issues,
            renderedPromptLength: renderedPrompt.length,
          }),
          renderedPrompt,
          errorMessage: assertionError,
          latencyMs: Date.now() - startedAt,
        },
      });
    }

    const updated = await this.prisma.promptEvalRun.update({
      where: { id: run.id },
      data: {
        status: failed > 0 ? "failed" : "succeeded",
        passed,
        failed,
        completedAt: new Date(),
      },
      include: { results: true },
    });

    return this.toEvalRunSummary(updated);
  }

  async getEvalRun(idOrKey: string, runId: string): Promise<PromptEvalRunSummary> {
    const definition = await this.getDefinition(idOrKey);
    const run = await this.prisma.promptEvalRun.findFirst({
      where: { id: runId, definitionId: definition.id },
      include: { results: true },
    });
    if (!run) throw new NotFoundException("prompt eval run not found");
    return this.toEvalRunSummary(run);
  }

  private async getDefinition(idOrKey: string): Promise<DefinitionWithActiveVersion> {
    const definition = await this.prisma.promptDefinition.findFirst({
      where: { OR: [{ id: idOrKey }, { key: idOrKey }] },
      include: { activeVersion: true },
    });
    if (!definition) {
      throw new NotFoundException("prompt definition not found");
    }
    return definition;
  }

  private async createVersionRecord(definitionId: string, userId: string | undefined, body: VersionInput) {
    const latest = await this.latestVersion(definitionId);
    const versionNumber = (latest?.version ?? 0) + 1;
    return this.prisma.promptVersion.create({
      data: {
        definitionId,
        version: versionNumber,
        template: body.template,
        variables: this.toJsonInput(body.variables ?? this.extractVariables(body.template)),
        model: body.model,
        modelOptions: this.toJsonInput(body.modelOptions ?? { temperature: 0.7 }),
        outputSchema: this.toJsonInputOrUndefined(body.outputSchema),
        changeNote: body.changeNote,
        status: body.status === "active" ? "active" : "draft",
        createdById: userId,
      },
    });
  }

  private latestVersion(definitionId: string) {
    return this.prisma.promptVersion.findFirst({
      where: { definitionId },
      orderBy: { version: "desc" },
    });
  }

  private toLegacyPromptSummary(definition: DefinitionWithActiveVersion) {
    const version = definition.activeVersion;
    return {
      id: definition.id,
      creatorId: definition.creatorId,
      name: definition.key,
      scene: toApiPromptScene(definition.scene),
      template: version?.template ?? "",
      variables: this.jsonStringArray(version?.variables),
      model: version?.model ?? null,
      modelOptions: this.jsonObject(version?.modelOptions),
      outputSchema: this.jsonObject(version?.outputSchema),
      version: version?.version ?? 0,
      status: definition.status,
      usageCount: definition.usageCount,
      createdAt: definition.createdAt.toISOString(),
      updatedAt: definition.updatedAt.toISOString(),
    };
  }

  private toDefinitionSummary(definition: DefinitionWithActiveVersion): PromptDefinitionSummary {
    return {
      id: definition.id,
      key: definition.key,
      scene: toApiPromptScene(definition.scene),
      displayName: definition.displayName,
      description: definition.description,
      status: definition.status,
      usageCount: definition.usageCount,
      activeVersionId: definition.activeVersionId,
      activeVersion: definition.activeVersion ? this.toVersionSummary(definition.activeVersion) : null,
      createdAt: definition.createdAt.toISOString(),
      updatedAt: definition.updatedAt.toISOString(),
    };
  }

  private toVersionSummary(version: VersionRecord): PromptVersionSummary {
    return {
      id: version.id,
      definitionId: version.definitionId,
      version: version.version,
      template: version.template,
      variables: this.jsonStringArray(version.variables),
      model: version.model,
      modelOptions: this.jsonObject(version.modelOptions),
      outputSchema: this.jsonObject(version.outputSchema),
      changeNote: version.changeNote,
      status: version.status,
      createdAt: version.createdAt.toISOString(),
    };
  }

  private toTestCaseSummary(item: TestCaseRecord): PromptTestCaseSummary {
    return {
      id: item.id,
      definitionId: item.definitionId,
      name: item.name,
      input: this.jsonObject(item.input) ?? {},
      expectedOutput: item.expectedOutput,
      assertions: this.jsonObject(item.assertions),
      enabled: item.enabled,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private toEvalRunSummary(run: EvalRunWithResults): PromptEvalRunSummary {
    return {
      id: run.id,
      definitionId: run.definitionId,
      versionId: run.versionId,
      mode: run.mode,
      status: run.status,
      total: run.total,
      passed: run.passed,
      failed: run.failed,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      createdAt: run.createdAt.toISOString(),
      results: run.results.map((item) => ({
        id: item.id,
        runId: item.runId,
        testCaseId: item.testCaseId,
        status: item.status,
        input: this.jsonObject(item.input) ?? {},
        output: item.output,
        renderedPrompt: item.renderedPrompt,
        errorMessage: item.errorMessage,
        latencyMs: item.latencyMs,
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }

  private validateTemplate(template: string, declaredVariables: string[], input: Record<string, unknown>): PromptValidationIssue[] {
    const used = this.extractVariables(template);
    const issues: PromptValidationIssue[] = [];
    const declaredSet = new Set(declaredVariables);
    const usedSet = new Set(used);

    for (const variable of new Set(declaredVariables.filter((item, index, list) => list.indexOf(item) !== index))) {
      issues.push({ type: "duplicate_variable", severity: "warning", variable, message: `变量 ${variable} 重复声明` });
    }
    for (const variable of used) {
      if (!declaredSet.has(variable)) {
        issues.push({ type: "undeclared_variable", severity: "warning", variable, message: `模板使用了未声明变量 ${variable}` });
      }
      const value = this.resolveVariable(input, variable);
      if (value === undefined) {
        issues.push({ type: "missing_variable", severity: "error", variable, message: `测试输入缺少变量 ${variable}` });
      } else if (value === null || value === "") {
        issues.push({ type: "empty_variable", severity: "warning", variable, message: `变量 ${variable} 当前为空` });
      }
    }
    for (const variable of declaredVariables) {
      if (!usedSet.has(variable)) {
        issues.push({ type: "unused_variable", severity: "info", variable, message: `变量 ${variable} 已声明但模板未使用` });
      }
    }
    return issues;
  }

  private evaluateAssertions(renderedPrompt: string, assertions: Prisma.JsonValue | null) {
    const config = this.jsonObject(assertions);
    if (!config) return undefined;
    const mustContain = Array.isArray(config.mustContain) ? config.mustContain : [];
    const missing = mustContain.filter((item) => typeof item === "string" && !renderedPrompt.includes(item));
    if (missing.length) return `渲染结果缺少必须包含的文本：${missing.join(", ")}`;
    return undefined;
  }

  private extractVariables(template: string) {
    return Array.from(new Set(Array.from(template.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)).map((match) => match[1])));
  }

  private flattenObjectKeys(input: Record<string, unknown>) {
    const keys: string[] = [];
    const visit = (value: unknown, prefix: string) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        if (prefix) keys.push(prefix);
        return;
      }

      const entries = Object.entries(value as Record<string, unknown>);
      if (!entries.length && prefix) keys.push(prefix);
      for (const [key, child] of entries) {
        visit(child, prefix ? `${prefix}.${key}` : key);
      }
    };

    visit(input, "");
    return keys;
  }

  private interpolate(template: string, variables: Record<string, unknown>) {
    return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
      const value = this.resolveVariable(variables, key);
      if (Array.isArray(value)) return value.join("\n");
      if (value === null || value === undefined) return "";
      return String(value);
    });
  }

  private resolveVariable(variables: Record<string, unknown>, key: string) {
    return key.split(".").reduce<unknown>((current, part) => {
      if (current && typeof current === "object" && part in current) {
        return (current as Record<string, unknown>)[part];
      }
      return undefined;
    }, variables);
  }

  private jsonStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  }

  private jsonObject(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  }

  private toJsonInput(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }

  private toJsonInputOrUndefined(value: unknown): Prisma.InputJsonValue | undefined {
    return value === undefined ? undefined : this.toJsonInput(value);
  }

  private normalizeKey(value: string) {
    const key = value.trim();
    if (!key) throw new BadRequestException("prompt name is required");
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
      throw new BadRequestException("prompt name can only contain letters, numbers, underscores and hyphens");
    }
    return key;
  }

  private defaultModel() {
    return process.env.ARK_MODEL_ID ?? process.env.ARK_MODEL ?? "doubao-seed";
  }
}
