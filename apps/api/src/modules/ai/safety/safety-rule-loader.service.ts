import { Injectable } from "@nestjs/common";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AuditRiskType } from "@aicp/shared";
import { SAFETY_RISK_TYPES, type SafetyLexiconEntry } from "./safety-rule.types";

const RISK_FILE_HINTS: Array<{ type: Exclude<AuditRiskType, "none">; hints: string[] }> = [
  { type: "pornography", hints: ["porn", "sexual", "sex", "erotic", "涉黄", "色情", "黄色"] },
  { type: "gambling", hints: ["gamble", "gambling", "casino", "bet", "涉赌", "赌博", "博彩"] },
  { type: "drug", hints: ["drug", "narcotic", "涉毒", "毒品", "吸毒", "违禁药"] },
  { type: "vulgar", hints: ["vulgar", "abuse", "低俗", "辱骂", "脏话"] },
  { type: "privacy", hints: ["privacy", "personal", "隐私", "身份证", "手机号"] },
  { type: "illegal", hints: ["illegal", "crime", "违法", "犯罪", "违禁"] },
  { type: "fraud", hints: ["fraud", "scam", "诈骗", "欺诈", "黑产"] },
  { type: "minor", hints: ["minor", "teen", "未成年", "儿童", "青少年"] },
  { type: "sensitive", hints: ["sensitive", "politic", "敏感", "政治"] },
];

@Injectable()
export class SafetyRuleLoader {
  private cache: SafetyLexiconEntry[] | null = null;

  loadLexicons() {
    if (this.cache) return this.cache;

    const seen = new Set<string>();
    const entries: SafetyLexiconEntry[] = [];
    for (const filePath of this.findTextFiles()) {
      const type = this.inferRiskType(filePath);
      const terms = this.readTerms(filePath);
      for (const term of terms) {
        const key = `${type}:${term.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({
          type,
          term,
          ruleId: `lexicon:${type}:${this.safeRuleId(term)}`,
        });
      }
    }

    this.cache = entries;
    return entries;
  }

  private findTextFiles() {
    const candidates = [
      join(process.cwd(), "src/modules/ai/safety"),
      join(process.cwd(), "apps/api/src/modules/ai/safety"),
      join(__dirname, "../safety"),
    ];
    const files: string[] = [];
    for (const dir of candidates) {
      if (existsSync(dir)) {
        this.collectTextFiles(dir, files);
      }
    }
    return Array.from(new Set(files));
  }

  private collectTextFiles(dir: string, files: string[]) {
    for (const name of readdirSync(dir)) {
      const fullPath = join(dir, name);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        this.collectTextFiles(fullPath, files);
      } else if (stat.isFile() && fullPath.toLowerCase().endsWith(".txt")) {
        files.push(fullPath);
      }
    }
  }

  private readTerms(filePath: string) {
    return readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.replace(/^\uFEFF/, "").trim())
      .filter((line) => this.isUsableTerm(line));
  }

  private isUsableTerm(term: string) {
    if (term.length >= 2 && /[\u4e00-\u9fa5]/.test(term)) return true;
    return term.length >= 4;
  }

  private inferRiskType(filePath: string): Exclude<AuditRiskType, "none"> {
    const normalized = filePath.toLowerCase();
    for (const item of RISK_FILE_HINTS) {
      if (item.hints.some((hint) => normalized.includes(hint.toLowerCase()))) {
        return item.type;
      }
    }

    const parent = normalized.split(/[\\/]/).reverse().find((part) => SAFETY_RISK_TYPES.includes(part as Exclude<AuditRiskType, "none">));
    return (parent as Exclude<AuditRiskType, "none"> | undefined) ?? "sensitive";
  }

  private safeRuleId(term: string) {
    return Buffer.from(term).toString("base64url").slice(0, 24);
  }
}
