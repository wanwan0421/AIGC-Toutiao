import { Injectable } from "@nestjs/common";
import { AuditRiskLevel, type AuditCategoryScores, type AuditResult, type AuditRiskItem, type AuditRiskSeverity, type AuditRiskType } from "@aicp/shared";
import { SAFETY_RISK_TYPES, type SafetyRuleScanResult, type SafetyReviewInput } from "./safety-rule.types";

@Injectable()
export class SafetyResultMerger {
  merge(ruleResult: SafetyRuleScanResult, llmResult: AuditResult, input: SafetyReviewInput): AuditResult {
    const llmItems = (llmResult.riskItems ?? []).map((item) => this.normalizeItem(item, input)).filter(Boolean) as AuditRiskItem[];
    const candidates = this.mergeItems(ruleResult.riskItems, llmItems);

    const confirmedItems = this.suppressCoveredChildItems(this.confirmItems(candidates, llmItems, llmResult));
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
    if (isRuleOnly && isLexiconRule && !llmTypeConfirmed) return null;
    if (isRuleOnly && score < 0.45 && !llmResult.rewriteAvailable) return null;
    if (item.severity === "low") return null;

    return item;
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
