import { Injectable } from "@nestjs/common";
import { AuditRiskLevel, type AuditCategoryScores, type AuditResult, type AuditRiskItem, type AuditRiskSeverity, type AuditRiskType } from "@aicp/shared";
import { SAFETY_RISK_TYPES, type SafetyRuleScanResult, type SafetyReviewInput } from "./safety-rule.types";

@Injectable()
export class SafetyResultMerger {
  merge(ruleResult: SafetyRuleScanResult, llmResult: AuditResult, input: SafetyReviewInput): AuditResult {
    const llmItems = (llmResult.riskItems ?? []).map((item) => this.normalizeItem(item, input)).filter(Boolean) as AuditRiskItem[];
    const candidates = this.mergeItems(ruleResult.riskItems, llmItems);

    const confirmedBaseItems = this.suppressCoveredChildItems(this.confirmItems(candidates, llmItems, llmResult));
    const fallbackItem = this.shouldAddLlmFallbackRisk(confirmedBaseItems, llmResult)
      ? this.createLlmFallbackRiskItem(llmResult, input)
      : null;
    const confirmedItems = fallbackItem ? this.sortItems([...confirmedBaseItems, fallbackItem]) : confirmedBaseItems;
    const blockingItems = confirmedItems.filter((item) => item.severity === "medium" || item.severity === "high");
    const riskTypes = Array.from(new Set(blockingItems.map((item) => item.type))).filter((type) => type !== "none");
    const riskLevel = this.riskLevelFromItems(blockingItems);
    const categoryScores = this.mergeCategoryScores(ruleResult.categoryScores, llmResult.categoryScores ?? {}, confirmedItems);
    const reasons = this.reasonsFromItems(blockingItems, llmResult.reasons);

    return {
      passed: blockingItems.length === 0,
      riskLevel,
      riskTypes: riskTypes.length ? riskTypes : ["none"],
      reasons,
      rewriteAvailable: blockingItems.length > 0 || Boolean(llmResult.rewriteAvailable),
      riskItems: confirmedItems,
      categoryScores,
    };
  }

  private mergeItems(ruleItems: AuditRiskItem[], llmItems: AuditRiskItem[]) {
    const output: AuditRiskItem[] = [];
    const sorted = [...ruleItems, ...llmItems].sort((a, b) => {
      const severityDiff = this.severityWeight(b.severity) - this.severityWeight(a.severity);
      if (severityDiff !== 0) return severityDiff;
      const confidenceDiff = b.confidence - a.confidence;
      if (confidenceDiff !== 0) return confidenceDiff;
      return b.evidence.length - a.evidence.length;
    });

    for (const item of sorted) {
      const index = output.findIndex((current) => this.isSameOrOverlappingRisk(current, item));
      if (index >= 0) {
        output[index] = this.mergeOverlappingItem(output[index], item);
      } else {
        output.push(item);
      }
    }

    return this.sortItems(output);
  }

  private confirmItems(candidates: AuditRiskItem[], llmItems: AuditRiskItem[], llmResult: AuditResult) {
    const llmScores = llmResult.categoryScores ?? {};
    return this.sortItems(
      candidates
        .map((item) => this.confirmItem(item, llmItems, llmResult, llmScores))
        .filter((item): item is AuditRiskItem => Boolean(item))
    );
  }

  private confirmItem(
    item: AuditRiskItem,
    llmItems: AuditRiskItem[],
    llmResult: AuditResult,
    llmScores: AuditCategoryScores
  ): AuditRiskItem | null {
    const score = llmScores[item.type as Exclude<AuditRiskType, "none">] ?? 0;
    const hasLlmMatch = llmItems.some((llmItem) => this.isSameOrOverlappingRisk(item, llmItem) || this.isEvidenceMatch(item, llmItem));
    const llmTypeConfirmed = llmResult.riskTypes.includes(item.type) && score >= 0.55;
    const isRuleOnly = item.source === "rule";
    const isLexiconRule = Boolean(item.ruleId?.startsWith("lexicon:"));
    const isContextWhitelist = Boolean(item.ruleId?.includes(":context-whitelist"));
    const isCombinationRule = Boolean(item.ruleId?.startsWith("combo:"));
    const isHighSignalLexicon = isLexiconRule && this.isHighSignalLexiconItem(item);

    if (hasLlmMatch) {
      return {
        ...item,
        source: item.source === "rule" ? "merged" : item.source,
        confidence: Math.max(item.confidence, score),
      };
    }

    if (isContextWhitelist && score < 0.5) return null;
    if (item.severity === "high") return item;
    if (isCombinationRule) return item;
    if (isRuleOnly && isHighSignalLexicon && !isContextWhitelist && item.confidence >= 0.75) return item;
    if (isRuleOnly && isLexiconRule && !llmTypeConfirmed) return null;
    if (isRuleOnly && score < 0.45 && !llmResult.rewriteAvailable) return null;
    if (item.severity === "low") return null;

    return item;
  }

  private shouldAddLlmFallbackRisk(items: AuditRiskItem[], llmResult: AuditResult) {
    if (items.some((item) => item.severity === "medium" || item.severity === "high")) return false;
    return this.llmIndicatesBlockingRisk(llmResult);
  }

  private llmIndicatesBlockingRisk(llmResult: AuditResult) {
    if (llmResult.passed === false) return true;
    if (llmResult.riskLevel === AuditRiskLevel.Medium || llmResult.riskLevel === AuditRiskLevel.High) return true;

    const riskTypes = this.nonNoneRiskTypes(llmResult.riskTypes);
    if (!riskTypes.length) return false;

    return riskTypes.some((type) => (llmResult.categoryScores?.[type] ?? 0) >= 0.55) || Boolean(llmResult.rewriteAvailable);
  }

  private createLlmFallbackRiskItem(llmResult: AuditResult, input: SafetyReviewInput): AuditRiskItem {
    const type = this.nonNoneRiskTypes(llmResult.riskTypes)[0] ?? this.strongestCategoryType(llmResult.categoryScores) ?? "sensitive";
    const located = this.locateFallbackEvidence(type, input);
    const severity = llmResult.riskLevel === AuditRiskLevel.High ? "high" : "medium";
    const confidence = Math.max(llmResult.categoryScores?.[type] ?? 0, 0.82);
    const reason =
      llmResult.reasons.find((item) => item.trim()) ??
      "\u6a21\u578b\u8bc6\u522b\u5230\u5408\u89c4\u98ce\u9669\uff0c\u4f46\u672a\u8fd4\u56de\u7ed3\u6784\u5316\u98ce\u9669\u7247\u6bb5";

    return {
      id: `llm_fallback_${this.hash(`${type}:${located.field}:${located.startOffset}:${located.evidence}`)}`,
      type,
      severity,
      confidence: this.clamp(confidence),
      evidence: located.evidence,
      reason,
      source: "llm",
      field: located.field,
      startOffset: located.startOffset,
      endOffset: located.endOffset,
      suggestion:
        "\u8bf7\u5220\u9664\u6216\u91cd\u5199\u6a21\u578b\u6307\u51fa\u7684\u8fdd\u89c4\u3001\u5f15\u6d41\u6216\u654f\u611f\u8868\u8fbe",
    };
  }

  // 如果一个风险项被另一个更高严重级别的风险项覆盖了，并且它们的证据文本有包含关系或者位置高度重叠，那么就认为这个风险项是冗余的，可以被合并掉
  private suppressCoveredChildItems(items: AuditRiskItem[]) {
    return this.sortItems(
      items.filter((item) => {
        const parent = items.find(
          (candidate) =>
            candidate.id !== item.id &&
            this.severityWeight(candidate.severity) > this.severityWeight(item.severity) &&
            this.coversRisk(candidate, item)
        );
        return !parent;
      })
    );
  }

  // 合并
  private coversRisk(parent: AuditRiskItem, child: AuditRiskItem) {
    if (parent.field !== child.field) return false;

    if (
      parent.startOffset !== undefined &&
      parent.endOffset !== undefined &&
      child.startOffset !== undefined &&
      child.endOffset !== undefined
    ) {
      const parentContainsChild = parent.startOffset <= child.startOffset && parent.endOffset >= child.endOffset;
      if (parentContainsChild) return true;

      const overlapStart = Math.max(parent.startOffset, child.startOffset);
      const overlapEnd = Math.min(parent.endOffset, child.endOffset);
      const childLength = Math.max(1, child.endOffset - child.startOffset);
      return Math.max(0, overlapEnd - overlapStart) / childLength >= 0.8;
    }

    return Boolean(parent.evidence && child.evidence && parent.evidence.includes(child.evidence));
  }

  private normalizeItem(item: AuditRiskItem, input: SafetyReviewInput): AuditRiskItem | null {
    if (!item.evidence?.trim()) return null;
    const located = this.locateEvidence(item, input);
    const type = SAFETY_RISK_TYPES.includes(item.type as Exclude<AuditRiskType, "none">) ? item.type : "sensitive";
    return {
      ...item,
      id: item.id || `llm_${this.hash(`${type}:${item.evidence}:${located.field}:${located.startOffset}`)}`,
      type,
      source: item.source === "rule" ? "rule" : item.source === "merged" ? "merged" : "llm",
      severity: this.normalizeSeverity(item.severity),
      confidence: this.clamp(item.confidence),
      field: located.field,
      startOffset: located.startOffset,
      endOffset: located.endOffset,
      reason: item.reason?.trim() || "Model identified a potential compliance risk",
    };
  }

  private locateEvidence(item: AuditRiskItem, input: SafetyReviewInput) {
    if (item.field && item.startOffset !== undefined && item.endOffset !== undefined) {
      return { field: item.field, startOffset: item.startOffset, endOffset: item.endOffset };
    }

    const titleIndex = input.title.indexOf(item.evidence);
    if (titleIndex >= 0) {
      return { field: "title" as const, startOffset: titleIndex, endOffset: titleIndex + item.evidence.length };
    }

    const bodyIndex = input.body.indexOf(item.evidence);
    if (bodyIndex >= 0) {
      return { field: "body" as const, startOffset: bodyIndex, endOffset: bodyIndex + item.evidence.length };
    }

    return { field: item.field, startOffset: item.startOffset, endOffset: item.endOffset };
  }

  private locateFallbackEvidence(type: Exclude<AuditRiskType, "none">, input: SafetyReviewInput) {
    const fields = [
      { field: "body" as const, text: input.body },
      { field: "title" as const, text: input.title },
    ];
    const terms = this.riskEvidenceTerms(type);

    for (const current of fields) {
      const lowerText = current.text.toLowerCase();
      for (const term of terms) {
        const index = lowerText.indexOf(term.toLowerCase());
        if (index >= 0) {
          return this.evidenceWindow(current.field, current.text, index, term.length);
        }
      }
    }

    const fallback = fields.find((item) => item.text.trim());
    if (!fallback) {
      return { field: "body" as const, evidence: "\u5168\u6587", startOffset: 0, endOffset: 0 };
    }

    return this.evidenceWindow(fallback.field, fallback.text, 0, Math.min(fallback.text.length, 80));
  }

  private evidenceWindow(field: "title" | "body", text: string, index: number, length: number) {
    const startOffset = Math.max(0, index - 24);
    const endOffset = Math.min(text.length, index + Math.max(length, 48));
    const evidence = text.slice(startOffset, endOffset) || text.slice(0, 80) || "\u5168\u6587";
    return { field, evidence, startOffset, endOffset };
  }

  private nonNoneRiskTypes(riskTypes: AuditRiskType[] = []): Exclude<AuditRiskType, "none">[] {
    return riskTypes.filter((type): type is Exclude<AuditRiskType, "none"> => type !== "none" && SAFETY_RISK_TYPES.includes(type));
  }

  private strongestCategoryType(categoryScores: AuditCategoryScores | undefined): Exclude<AuditRiskType, "none"> | null {
    let winner: Exclude<AuditRiskType, "none"> | null = null;
    let winnerScore = 0;
    for (const type of SAFETY_RISK_TYPES) {
      const score = categoryScores?.[type] ?? 0;
      if (score > winnerScore) {
        winner = type;
        winnerScore = score;
      }
    }
    return winnerScore >= 0.55 ? winner : null;
  }

  private isHighSignalLexiconItem(item: AuditRiskItem) {
    if (item.type !== "pornography" && item.type !== "gambling" && item.type !== "drug" && item.type !== "illegal" && item.type !== "fraud") {
      return false;
    }

    const evidence = item.evidence.toLowerCase();
    const terms: Record<Exclude<AuditRiskType, "none">, string[]> = {
      pornography: ["约炮", "裸聊", "招嫖", "卖淫", "嫖娼", "色情服务", "涉黄引流"],
      gambling: ["赌博", "博彩", "私彩", "网赌", "赌球", "下注", "盘口", "赔率", "赌资", "涉赌宣传"],
      drug: ["毒品", "冰毒", "大麻", "摇头丸", "贩毒", "吸毒", "涉毒"],
      sensitive: [],
      vulgar: [],
      privacy: [],
      illegal: ["违法交易", "非法交易", "黑产", "违禁品", "代办证件"],
      fraud: ["诈骗", "刷单返利", "稳赚", "拉人头", "杀猪盘"],
      minor: [],
    };

    return terms[item.type as Exclude<AuditRiskType, "none">].some((term) => evidence.includes(term.toLowerCase()));
  }

  private riskEvidenceTerms(type: AuditRiskType) {
    const common = ["违规", "违法", "引流", "私聊", "加微信", "联系方式", "二维码"];
    const terms: Record<Exclude<AuditRiskType, "none">, string[]> = {
      pornography: ["涉黄", "色情", "约炮", "裸聊", "招嫖", "卖淫", "嫖娼", "涉黄引流"],
      gambling: ["涉赌", "赌博", "博彩", "私彩", "彩票", "下注", "盘口", "赔率", "网赌", "涉赌宣传"],
      drug: ["涉毒", "毒品", "冰毒", "大麻", "摇头丸", "贩毒"],
      sensitive: ["敏感", "引流", "加微信", "私聊", "联系方式", "二维码"],
      vulgar: ["低俗", "粗俗", "辱骂"],
      privacy: ["隐私", "泄露", "身份证", "手机号", "银行卡"],
      illegal: ["违法", "非法", "黑产", "违禁", "交易", "出售", "代办"],
      fraud: ["诈骗", "返利", "稳赚", "拉人头", "刷单"],
      minor: ["未成年人", "未成年", "儿童"],
    };
    return [...(terms[type as Exclude<AuditRiskType, "none">] ?? []), ...common];
  }

  private isSameOrOverlappingRisk(a: AuditRiskItem, b: AuditRiskItem) {
    if (a.type !== b.type || a.field !== b.field) return false;
    if (a.startOffset === undefined || a.endOffset === undefined || b.startOffset === undefined || b.endOffset === undefined) {
      return this.isEvidenceMatch(a, b);
    }
    return a.startOffset < b.endOffset && b.startOffset < a.endOffset;
  }

  private isEvidenceMatch(a: AuditRiskItem, b: AuditRiskItem) {
    if (!a.evidence || !b.evidence) return false;
    return a.evidence === b.evidence || a.evidence.includes(b.evidence) || b.evidence.includes(a.evidence);
  }

  private mergeOverlappingItem(a: AuditRiskItem, b: AuditRiskItem): AuditRiskItem {
    const winner = this.preferItem(a, b);
    return {
      ...winner,
      source: a.source === b.source ? a.source : "merged",
      severity: this.higherSeverity(a.severity, b.severity),
      confidence: Math.max(a.confidence, b.confidence),
      reason: this.joinUnique([a.reason, b.reason]),
      suggestion: winner.suggestion ?? a.suggestion ?? b.suggestion,
      ruleId: a.ruleId ?? b.ruleId,
    };
  }

  private preferItem(a: AuditRiskItem, b: AuditRiskItem) {
    const severityDiff = this.severityWeight(a.severity) - this.severityWeight(b.severity);
    if (severityDiff !== 0) return severityDiff > 0 ? a : b;
    if (a.confidence !== b.confidence) return a.confidence > b.confidence ? a : b;
    return a.evidence.length >= b.evidence.length ? a : b;
  }

  private sortItems(items: AuditRiskItem[]) {
    return [...items].sort((a, b) => {
      if ((a.field ?? "") !== (b.field ?? "")) return (a.field ?? "").localeCompare(b.field ?? "");
      return (a.startOffset ?? 0) - (b.startOffset ?? 0);
    });
  }

  private riskLevelFromItems(items: AuditRiskItem[]) {
    if (items.some((item) => item.severity === "high")) return AuditRiskLevel.High;
    if (items.some((item) => item.severity === "medium")) return AuditRiskLevel.Medium;
    return AuditRiskLevel.Low;
  }

  private mergeCategoryScores(ruleScores: AuditCategoryScores, llmScores: AuditCategoryScores, items: AuditRiskItem[]) {
    const scores: AuditCategoryScores = {};
    for (const type of SAFETY_RISK_TYPES) {
      scores[type] = Math.max(
        llmScores[type] ?? 0,
        ...items.filter((item) => item.type === type).map((item) => item.confidence),
        (items.some((item) => item.type === type) ? ruleScores[type] : 0) ?? 0
      );
    }
    return scores;
  }

  private reasonsFromItems(items: AuditRiskItem[], fallback: string[] = []) {
    const reasons = items.map((item) => item.reason).filter(Boolean);
    if (reasons.length) return Array.from(new Set(reasons)).slice(0, 8);
    return fallback.length ? fallback : ["No obvious compliance risk found"];
  }

  private higherSeverity(a: AuditRiskSeverity, b: AuditRiskSeverity): AuditRiskSeverity {
    return this.severityWeight(a) >= this.severityWeight(b) ? a : b;
  }

  private normalizeSeverity(value: unknown): AuditRiskSeverity {
    return value === "high" || value === "medium" || value === "low" ? value : "medium";
  }

  private severityWeight(value: AuditRiskSeverity) {
    return value === "high" ? 3 : value === "medium" ? 2 : 1;
  }

  private joinUnique(values: string[]) {
    return Array.from(new Set(values.filter(Boolean))).join("; ");
  }

  private clamp(value: number) {
    if (!Number.isFinite(value)) return 0.75;
    return Math.min(1, Math.max(0, Number(value.toFixed(2))));
  }

  private hash(value: string) {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
      hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
    }
    return hash.toString(36);
  }
}
