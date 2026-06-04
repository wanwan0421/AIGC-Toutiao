import { AuditRiskLevel, type AuditCategoryScores, type AuditRiskItem, type AuditRiskSeverity, type AuditRiskType } from "@aicp/shared";

export const SAFETY_RISK_TYPES: Exclude<AuditRiskType, "none">[] = [
  "pornography",
  "gambling",
  "drug",
  "sensitive",
  "vulgar",
  "privacy",
  "illegal",
  "fraud",
  "minor",
];

export type SafetyReviewInput = {
  title: string;
  body: string;
};

export type SafetyRuleScanResult = {
  riskItems: AuditRiskItem[];
  riskTypes: AuditRiskType[];
  riskLevel: AuditRiskLevel;
  categoryScores: AuditCategoryScores;
};

export type SafetyLexiconEntry = {
  type: Exclude<AuditRiskType, "none">;
  term: string;
  ruleId: string;
};

export type RegexSafetyRule = {
  id: string;
  type: Exclude<AuditRiskType, "none">;
  severity: AuditRiskSeverity;
  confidence: number;
  pattern: RegExp;
  reason: string;
  suggestion: string;
};
