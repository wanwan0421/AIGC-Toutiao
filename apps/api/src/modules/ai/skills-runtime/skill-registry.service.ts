import { Injectable } from "@nestjs/common";
import type { AiSkillKey } from "@aicp/shared";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { SkillResourceIndex, SkillTrustedContext } from "./skill-runtime.types";

type SkillManifest = {
  key: AiSkillKey;
  name: string;
  description: string;
  fallbackBody: string;
};

type LoadedSkillManifest = SkillManifest & {
  resources: SkillResourceIndex;
};

type SkillResourceFolder = keyof SkillResourceIndex;
export type ModelResourceSelection = Partial<Pick<SkillResourceIndex, "prompts" | "references" | "assets">>;
type ModelResourceFolder = keyof ModelResourceSelection;

const requireSkillScript = createRequire(__filename);

const FALLBACK_SKILLS: Record<AiSkillKey, SkillManifest> = {
  "content-production-line": {
    key: "content-production-line",
    name: "content-production-line",
    description: "根据主题、素材、历史对话或当前编辑内容生成完整图文初稿。",
    fallbackBody: "按需求理解、正文生成、视觉规划、输出归一化、图片生成的顺序执行。",
  },
  "content-safety-reviewer": {
    key: "content-safety-reviewer",
    name: "content-safety-reviewer",
    description: "结合规则词库、LLM 语义审核和合规改写建议判断内容是否可以发布。",
    fallbackBody: "按规则扫描、语义审核、结果合并、失败改写的顺序执行。",
  },
};

@Injectable()
export class SkillRegistryService {
  // 为路由智能体提供技能列表接口
  listForRouter() {
    return Object.values(FALLBACK_SKILLS).map(({ key, name, description }) => ({ key, name, description }));
  }

  isKnownSkillKey(value: unknown): value is AiSkillKey {
    return typeof value === "string" && value in FALLBACK_SKILLS;
  }

  // 为技能执行器提供技能加载接口
  loadSkill(key: AiSkillKey): LoadedSkillManifest {
    const resources = this.resourceIndex(key);
    return { ...this.loadSkillInstructions(key), resources };
  }

  // Read SKILL.md only after routing has selected a Skill. Resource files remain lazy.
  loadSkillInstructions(key: AiSkillKey): SkillManifest {
    const fallback = FALLBACK_SKILLS[key];
    const file = this.readSkillFile(key);
    if (!file) return fallback;

    const frontmatter = file.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!frontmatter) {
      return { ...fallback, fallbackBody: file };
    }

    const meta = frontmatter[1];
    const body = frontmatter[2].trim();
    const name = this.readMeta(meta, "name") ?? fallback.name;
    const description = this.readMeta(meta, "description") ?? fallback.description;
    return {
      key,
      name,
      description,
      fallbackBody: body || fallback.fallbackBody,
    };
  }

  // Model context deliberately excludes scripts. Trusted scripts are executed on the server.
  modelResourceText(key: AiSkillKey, selection: ModelResourceSelection) {
    return this.selectedResourceText(key, selection, ["prompts", "references", "assets"]);
  }

  formatSkillInstructions(skill: SkillManifest) {
    return [`Selected Skill: ${skill.name} (${skill.key})`, "", "SKILL.md:", skill.fallbackBody].join("\n");
  }

  executeScriptExport<T>(key: AiSkillKey, file: string, exportName: string, ...args: unknown[]): T {
    const root = this.skillRoot(key);
    if (!root) throw new Error(`Skill not found: ${key}`);
    const absolute = this.resourcePath(root, "scripts", file);
    if (!absolute || !existsSync(absolute)) throw new Error(`Skill script not found: ${key}/${file}`);
    const script = requireSkillScript(absolute) as Record<string, unknown>;
    const handler = script[exportName];
    if (typeof handler !== "function") throw new Error(`Skill script export not found: ${exportName}`);
    return (handler as (...values: unknown[]) => T)(...args);
  }

  // 为技能执行器提供可信上下文构建接口
  trustedContextFor(key: AiSkillKey, selection: ModelResourceSelection = {}): SkillTrustedContext {
    const loaded = this.loadSkill(key);
    return {
      skillKey: key,
      skillName: loaded.name,
      instructions: loaded.fallbackBody,
      resources: loaded.resources,
      resourceText: this.selectedResourceText(key, selection, ["prompts", "references", "assets"]),
    };
  }

  readResourceText(key: AiSkillKey, folder: SkillResourceFolder, file: string) {
    const root = this.skillRoot(key);
    return root ? this.readResource(root, folder, file) : "";
  }

  formatTrustedContext(context: SkillTrustedContext) {
    return [
      `已选择的 Skill：${context.skillName} (${context.skillKey})`,
      "",
      "SKILL.md:",
      context.instructions,
      context.resourceText ? "\n已加载的 Skill 资源：" : "",
      context.resourceText,
    ]
      .filter(Boolean)
      .join("\n");
  }

  private readSkillFile(key: AiSkillKey) {
    const root = this.skillRoot(key);
    if (!root) return undefined;
    return readFileSync(join(root, "SKILL.md"), "utf8");
  }

  private skillRoot(key: AiSkillKey) {
    const candidates = [
      join(process.cwd(), "src", "skills", key),
      join(process.cwd(), "apps", "api", "src", "skills", key),
    ];
    return candidates.find((candidate) => existsSync(join(candidate, "SKILL.md")));
  }

  private resourceIndex(key: AiSkillKey): SkillResourceIndex {
    const root = this.skillRoot(key);
    return {
      prompts: root ? this.listFiles(root, "prompts") : [],
      references: root ? this.listFiles(root, "references") : [],
      scripts: root ? this.listFiles(root, "scripts") : [],
      assets: root ? this.listFiles(root, "assets") : [],
    };
  }

  private listFiles(root: string, folder: SkillResourceFolder) {
    const base = join(root, folder);
    if (!existsSync(base)) return [];

    const walk = (current: string, prefix = ""): string[] => {
      return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const absolute = join(current, entry.name);
        if (entry.isDirectory()) return walk(absolute, relative);
        return relative;
      });
    };

    return walk(base).sort();
  }

  // 根据选择的资源列表构建可信上下文文本，供技能执行器使用
  private selectedResourceText(
    key: AiSkillKey,
    selection: ModelResourceSelection,
    folders: ModelResourceFolder[] = ["prompts", "references", "assets"]
  ) {
    const root = this.skillRoot(key);
    if (!root) return "";

    const sections: string[] = [];
    for (const folder of folders) {
      for (const file of selection[folder] ?? []) {
        const text = this.readResource(root, folder, file);
        if (text) {
          sections.push(`--- ${folder}/${file} ---\n${text}`);
        }
      }
    }
    return sections.join("\n\n");
  }

  // 安全地读取资源文件内容，防止路径穿越攻击
  private readResource(root: string, folder: SkillResourceFolder, file: string) {
    const absolute = this.resourcePath(root, folder, file);
    if (!absolute) return "";
    if (!existsSync(absolute)) return "";
    return readFileSync(absolute, "utf8");
  }

  private resourcePath(root: string, folder: SkillResourceFolder, file: string) {
    const safeFile = file.replace(/\\/g, "/");
    if (!safeFile || safeFile.includes("..") || safeFile.startsWith("/")) return undefined;
    return join(root, folder, safeFile);
  }

  private readMeta(frontmatter: string, key: string) {
    const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return match?.[1]?.trim();
  }
}
