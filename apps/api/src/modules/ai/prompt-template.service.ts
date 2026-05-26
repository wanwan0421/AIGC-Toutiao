import { Injectable } from "@nestjs/common";
import { PromptScene } from "@prisma/client";
import { PrismaService } from "../../infra/prisma/prisma.service";

@Injectable()
export class PromptTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  async render(scene: string, variables: Record<string, unknown>, fallbackTemplate: string) {
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
      model: prompt?.model ?? undefined,
      prompt: this.interpolate(prompt?.template ?? fallbackTemplate, variables),
    };
  }

  private mapScene(scene: string) {
    if (scene.includes("audit")) return PromptScene.audit;
    if (scene.includes("score")) return PromptScene.score;
    if (scene.includes("rewrite") || scene.includes("selection")) return PromptScene.rewrite;
    return PromptScene.generate;
  }

  private canUseSceneFallback(scene: string) {
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
}
