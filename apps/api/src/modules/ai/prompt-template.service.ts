import { Injectable } from "@nestjs/common";
import { PromptScene } from "@prisma/client";
import { PrismaService } from "../../infra/prisma/prisma.service";

export type PromptRenderResult = {
  promptTemplateId?: string;
  promptKey?: string;
  promptVersionId?: string;
  model?: string;
  modelOptions?: Record<string, unknown> | null;
  outputSchema?: Record<string, unknown> | null;
  prompt: string;
};

@Injectable()
export class PromptTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  async render(scene: string, variables: Record<string, unknown>, fallbackTemplate = ""): Promise<PromptRenderResult> {
    const exactDefinition = await this.prisma.promptDefinition
      .findFirst({
        where: {
          status: "active",
          key: scene,
          activeVersionId: { not: null },
        },
        include: { activeVersion: true },
      })
      .catch(() => null);

    let sceneDefinition: typeof exactDefinition = null;
    if (!exactDefinition && this.canUseSceneFallback(scene)) {
      sceneDefinition = await this.prisma.promptDefinition
        .findFirst({
          where: {
            status: "active",
            scene: this.mapScene(scene),
            activeVersionId: { not: null },
          },
          include: { activeVersion: true },
          orderBy: [{ updatedAt: "desc" }],
        })
        .catch(() => null);
    }

    const definition = exactDefinition ?? sceneDefinition;
    if (definition?.activeVersion) {
      await this.prisma.promptDefinition
        .update({
          where: { id: definition.id },
          data: { usageCount: { increment: 1 } },
        })
        .catch(() => undefined);

      return {
        promptKey: definition.key,
        promptVersionId: definition.activeVersion.id,
        model: definition.activeVersion.model ?? undefined,
        modelOptions: this.jsonObject(definition.activeVersion.modelOptions),
        outputSchema: this.jsonObject(definition.activeVersion.outputSchema),
        prompt: this.interpolate(definition.activeVersion.template, variables),
      };
    }

    return this.renderLegacy(scene, variables, fallbackTemplate);
  }

  private async renderLegacy(scene: string, variables: Record<string, unknown>, fallbackTemplate: string): Promise<PromptRenderResult> {
    const exactPrompt = await this.prisma.promptTemplate
      .findFirst({
        where: {
          status: "active",
          name: scene,
        },
        orderBy: [{ version: "desc" }, { updatedAt: "desc" }],
      })
      .catch(() => null);

    let scenePrompt: typeof exactPrompt = null;
    if (!exactPrompt && this.canUseSceneFallback(scene)) {
      scenePrompt = await this.prisma.promptTemplate
        .findFirst({
          where: {
            status: "active",
            scene: this.mapScene(scene),
          },
          orderBy: [{ version: "desc" }, { updatedAt: "desc" }],
        })
        .catch(() => null);
    }

    const prompt = exactPrompt ?? scenePrompt;

    if (prompt) {
      await this.prisma.promptTemplate
        .update({
          where: { id: prompt.id },
          data: { usageCount: { increment: 1 } },
        })
        .catch(() => undefined);
    }

    return {
      promptTemplateId: prompt?.id,
      promptKey: prompt?.name ?? scene,
      model: prompt?.model ?? undefined,
      modelOptions: this.jsonObject(prompt?.modelOptions),
      prompt: this.interpolate(prompt?.template ?? fallbackTemplate, variables),
    };
  }

  private mapScene(scene: string) {
    if (scene.includes("audit") || scene.includes("safety") || scene.includes("review")) return PromptScene.audit;
    if (scene.includes("score") || scene.includes("quality")) return PromptScene.score;
    if (scene.includes("rewrite") || scene.includes("selection") || scene.includes("compliance")) return PromptScene.rewrite;
    return PromptScene.generate;
  }

  private canUseSceneFallback(scene: string) {
    // 只有调用方明确传通用场景时才降级到 scene 级模板。
    // 具体 key 缺失时应使用 Agent 的代码 fallback，避免 safety_review 误用旧 moderation_review。
    return ["generate", "audit", "score", "rewrite"].includes(scene);
  }

  private interpolate(template: string, variables: Record<string, unknown>) {
    return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
      const value = key.split(".").reduce<unknown>((current, part) => {
        if (current && typeof current === "object" && part in current) {
          return (current as Record<string, unknown>)[part];
        }
        return undefined;
      }, variables);

      if (Array.isArray(value)) return value.join("\n");
      if (value === null || value === undefined) return "";
      return String(value);
    });
  }

  private jsonObject(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  }
}
