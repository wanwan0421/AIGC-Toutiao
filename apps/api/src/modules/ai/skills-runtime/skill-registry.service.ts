import { Injectable } from "@nestjs/common";
import type { AiSkillKey } from "@aicp/shared";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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

type SkillResourceSelection = Partial<SkillResourceIndex>;

const FALLBACK_SKILLS: Record<AiSkillKey, SkillManifest> = {
  "content-production-line": {
    key: "content-production-line",
    name: "content-production-line",
    description: "根据主题、素材、历史对话或当前编辑内容生成完整图文初稿。",
    fallbackBody: "按需求理解、正文生成、标题候选、标签、封面建议、配图提示词和图片生成的顺序执行。",
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
  listForRouter() {
    return Object.values(FALLBACK_SKILLS).map((skill) => {
      const loaded = this.loadSkill(skill.key);
      return {
        key: skill.key,
        name: loaded.name,
        description: loaded.description,
      };
    });
  }

  loadSkill(key: AiSkillKey): LoadedSkillManifest {
    const fallback = FALLBACK_SKILLS[key];
    const resources = this.resourceIndex(key);
    const file = this.readSkillFile(key);
    if (!file) return { ...fallback, resources };

    const frontmatter = file.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!frontmatter) {
      return { ...fallback, fallbackBody: file, resources };
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
      resources,
    };
  }

  instructionsFor(key: AiSkillKey) {
    return this.loadSkill(key).fallbackBody;
  }

  trustedContextFor(key: AiSkillKey, selection: SkillResourceSelection = {}): SkillTrustedContext {
    const loaded = this.loadSkill(key);
    return {
      skillKey: key,
      skillName: loaded.name,
      instructions: loaded.fallbackBody,
      resources: loaded.resources,
      resourceText: this.selectedResourceText(key, selection),
    };
  }

  formatTrustedContext(context: SkillTrustedContext) {
    return [
      `Selected Skill: ${context.skillName} (${context.skillKey})`,
      "",
      "SKILL.md:",
      context.instructions,
      context.resourceText ? "\nLoaded Skill resources:" : "",
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

  private listFiles(root: string, folder: keyof SkillResourceIndex) {
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

  private selectedResourceText(key: AiSkillKey, selection: SkillResourceSelection) {
    const root = this.skillRoot(key);
    if (!root) return "";

    const sections: string[] = [];
    for (const folder of ["prompts", "references", "scripts", "assets"] as Array<keyof SkillResourceIndex>) {
      for (const file of selection[folder] ?? []) {
        const text = this.readResource(root, folder, file);
        if (text) {
          sections.push(`--- ${folder}/${file} ---\n${text}`);
        }
      }
    }
    return sections.join("\n\n");
  }

  private readResource(root: string, folder: keyof SkillResourceIndex, file: string) {
    const safeFile = file.replace(/\\/g, "/");
    if (safeFile.includes("..")) return "";
    const absolute = join(root, folder, safeFile);
    if (!existsSync(absolute)) return "";
    return readFileSync(absolute, "utf8");
  }

  private readMeta(frontmatter: string, key: string) {
    const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return match?.[1]?.trim();
  }
}
