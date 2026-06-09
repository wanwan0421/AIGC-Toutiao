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

type DefinitionWithActiveVersion = any;
type VersionRecord = any;
type TestCaseRecord = any;
type EvalRunWithResults = any;

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
  constructor(private readonly prisma: PrismaService) {}

  async list(scene?: PromptScene) {
    const items = await this.prisma.promptDefinition.findMany({
      where: scene ? { scene: toDbPromptScene(scene) } : undefined,
      include: { activeVersion: true },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    });
    return items.map((item: any) => this.toLegacyPromptSummary(item));
  }

  async listDefinitions(scene?: PromptScene): Promise<PromptDefinitionSummary[]> {
    const items = await this.prisma.promptDefinition.findMany({
      where: scene ? { scene: toDbPromptScene(scene) } : undefined,
      include: { activeVersion: true },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    });
    return items.map((item: any) => this.toDefinitionSummary(item));
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
    const key = body.name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '');
    const definition = await this.prisma.promptDefinition.create({
      data: {
        key,
        displayName: body.name,
        description: body.description ?? '',
        scene: toDbPromptScene(body.scene),
        status: 'active',
      },
    });

    const version = await this.prisma.promptVersion.create({
      data: {
        definitionId: definition.id,
        version: 1,
        template: body.template,
        variables: body.variables,
        model: body.model,
        modelOptions: body.modelOptions as any,
        outputSchema: body.outputSchema as any,
        status: 'active',
        changeNote: body.changeNote || 'Initial version',
      },
    });

    await this.prisma.promptDefinition.update({
      where: { id: definition.id },
      data: { activeVersionId: version.id },
    });

    return { definition, version };
  }

  async update(userId: string, idOrKey: string, body: any) {
    return this.updateDefinition(userId, idOrKey, body);
  }

  async updateDefinition(userId: string, idOrKey: string, body: {
    displayName?: string;
    description?: string;
    scene?: PromptScene;
  }) {
    const definition = await this.getDefinition(idOrKey);
    return this.prisma.promptDefinition.update({
      where: { id: definition.id },
      data: {
        displayName: body.displayName,
        description: body.description,
        scene: body.scene ? toDbPromptScene(body.scene) : undefined,
      },
    });
  }

  async createVersion(userId: string, idOrKey: string, body: VersionInput) {
    const definition = await this.getDefinition(idOrKey);
    const latest = await this.prisma.promptVersion.findFirst({
      where: { definitionId: definition.id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const newVersionNumber = (latest?.version ?? 0) + 1;
    const version = await this.prisma.promptVersion.create({
      data: {
        definitionId: definition.id,
        version: newVersionNumber,
        template: body.template,
        variables: body.variables,
        model: body.model,
        modelOptions: body.modelOptions as any,
        outputSchema: body.outputSchema as any,
        status: body.status ?? 'draft',
        changeNote: body.changeNote || '',
      },
    });
    if (body.status === 'active') {
      await this.prisma.$transaction([
        this.prisma.promptVersion.updateMany({
          where: { definitionId: definition.id, id: { not: version.id } },
          data: { status: 'draft' },
        }),
        this.prisma.promptDefinition.update({
          where: { id: definition.id },
          data: { activeVersionId: version.id },
        }),
      ]);
    }
    return version;
  }

  async getDefinition(idOrKey: string) {
    const definition = await this.prisma.promptDefinition.findFirst({
      where: { OR: [{ id: idOrKey }, { key: idOrKey }] },
      include: { activeVersion: true },
    });
    if (!definition) throw new NotFoundException('Prompt definition not found');
    return definition;
  }

  async listVersions(definitionId: string) {
    const versions = await this.prisma.promptVersion.findMany({
      where: { definitionId },
      orderBy: { version: 'desc' },
    });
    return versions.map((item: any) => this.toVersionSummary(item));
  }

  async getVersion(definitionId: string, versionNumber: number) {
    const version = await this.prisma.promptVersion.findUnique({
      where: { definitionId_version: { definitionId, version: versionNumber } },
    });
    if (!version) throw new NotFoundException('Prompt version not found');
    return version;
  }

  async activateVersion(userId: string, definitionId: string, versionNumber: number) {
    const version = await this.getVersion(definitionId, versionNumber);
    await this.prisma.$transaction([
      this.prisma.promptVersion.updateMany({
        where: { definitionId, id: { not: version.id } },
        data: { status: 'draft' },
      }),
      this.prisma.promptVersion.update({
        where: { id: version.id },
        data: { status: 'active' },
      }),
      this.prisma.promptDefinition.update({
        where: { id: definitionId },
        data: { activeVersionId: version.id },
      }),
    ]);
    return true;
  }

  async createTestCase(userId: string, definitionId: string, body: { name: string; inputVars: Record<string, unknown>; expected?: string; description?: string }) {
    return this.prisma.promptTestCase.create({
      data: {
        definitionId,
        name: body.name,
        input: body.inputVars as any,
        expectedOutput: (body.expected ?? '') as any,
      } as any,
    });
  }

  async listTestCases(definitionId: string) {
    const items = await this.prisma.promptTestCase.findMany({ where: { definitionId }, orderBy: { createdAt: 'desc' } });
    return items.map((item: any) => this.toTestCaseSummary(item));
  }

  async updateTestCase(userId: string, id: string, body: Partial<{ name: string; inputVars: Record<string, unknown>; expected: string; description: string }>) {
    return this.prisma.promptTestCase.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.inputVars !== undefined && { input: body.inputVars as any }),
        ...(body.expected !== undefined && { expectedOutput: body.expected }),
      } as any,
    });
  }

  async deleteTestCase(userId: string, id: string) {
    await this.prisma.promptTestCase.delete({ where: { id } });
    return { success: true };
  }

  async runEvaluation(userId: string, definitionId: string, body: { testCaseIds?: string[] }) {
    const run = await this.prisma.promptEvalRun.create({
      data: { definitionId, initiatedBy: userId } as any,
    });
    const testCases = body.testCaseIds?.length
      ? await this.prisma.promptTestCase.findMany({ where: { id: { in: body.testCaseIds } } })
      : await this.prisma.promptTestCase.findMany({ where: { definitionId } });

    const results = [];
    for (const tc of testCases) {
      results.push({
        evalRunId: run.id,
        testCaseId: tc.id,
        actual: '',
        passed: false,
        score: 0,
        reasoning: 'Mock evaluation result (LLM integration pending)',
      });
    }

    await this.prisma.promptEvalResult.createMany({ data: results as any });
    return this.prisma.promptEvalRun.findUniqueOrThrow({ where: { id: run.id }, include: { results: true } });
  }

  async getEvalRun(id: string) {
    return this.prisma.promptEvalRun.findUniqueOrThrow({ where: { id }, include: { results: true } });
  }

  async renderPreview(userId: string, definitionId: string, body: any) {
    return { rendered: '', issues: [] as any };
  }

  async listEvalRuns(definitionId: string) {
    const runs = await this.prisma.promptEvalRun.findMany({
      where: { definitionId },
      orderBy: { createdAt: 'desc' },
      include: { results: true },
    });
    return runs.map((run: any) => ({
      id: run.id,
      createdAt: run.createdAt,
      testCaseCount: run.results.length,
      passedCount: run.results.filter((item: any) => item.passed).length,
    }));
  }

  private toLegacyPromptSummary(row: DefinitionWithActiveVersion) {
    return {
      id: row.id,
      key: row.key,
      name: row.displayName,
      description: row.description,
      scene: row.scene,
      version: row.activeVersion?.version ?? 0,
      template: row.activeVersion?.template ?? '',
      variables: row.activeVersion?.variables ?? [],
      model: row.activeVersion?.model,
      modelOptions: row.activeVersion?.modelOptions ?? {},
      usageCount: (row as any).usageCount ?? 0,
    };
  }

  private toDefinitionSummary(row: DefinitionWithActiveVersion): PromptDefinitionSummary {
    return {
      id: row.id,
      key: row.key,
      displayName: row.displayName,
      description: row.description,
      scene: toApiPromptScene(row.scene),
      status: row.status,
      activeVersionId: row.activeVersionId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      usageCount: (row as any).usageCount ?? 0,
    };
  }

  private toVersionSummary(row: VersionRecord): PromptVersionSummary {
    return {
      id: row.id,
      definitionId: row.definitionId,
      version: row.version,
      template: row.template,
      variables: row.variables ?? [],
      model: row.model ?? null,
      modelOptions: (row.modelOptions ?? {}) as Record<string, any>,
      outputSchema: (row.outputSchema ?? null) as Record<string, any> | null,
      status: row.status,
      changeNote: row.changeNote ?? '',
      createdAt: row.createdAt,
    };
  }

  private toTestCaseSummary(row: TestCaseRecord): PromptTestCaseSummary {
    return {
      id: row.id,
      definitionId: row.definitionId,
      name: row.name,
      createdAt: row.createdAt,
    } as any;
  }

  private evaluateAssertions(renderedPrompt: string, assertions: any) {
    return [];
  }
}
