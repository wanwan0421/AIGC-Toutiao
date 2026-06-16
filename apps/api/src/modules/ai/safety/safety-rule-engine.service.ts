import { Injectable } from "@nestjs/common";
import { AuditRiskLevel, type AuditRiskField, type AuditRiskItem, type AuditRiskSeverity, type AuditRiskType } from "@aicp/shared";
import { SafetyRuleLoader } from "./safety-rule-loader.service";
import { SAFETY_RISK_TYPES, type RegexSafetyRule, type SafetyLexiconEntry, type SafetyRuleScanResult, type SafetyReviewInput } from "./safety-rule.types";

const WHITELIST_CONTEXT_TERMS = [
  "禁毒宣传",
  "远离毒品",
  "反诈提醒",
  "赌博危害",
  "法律科普",
  "案例分析",
  "举报电话",
  "风险提示",
  "不要参与",
  "警惕",
  "抵制",
];

const CONTACT_TERMS = ["微信", "vx", "v信", "加v", "私聊", "联系方式", "qq", "电报", "telegram", "tg"];
const TRANSACTION_TERMS = ["购买", "出售", "交易", "货到付款", "包邮", "价格", "报价", "下单", "渠道", "代理"];
const PRICE_TERMS = ["价格", "报价", "一单", "包夜", "低价", "出售", "付款", "发链接", "私聊", "加微信", "付费", "接单"];
const HIGH_SIGNAL_GAMBLING_TERMS = ["赌博", "博彩", "私彩", "赌球", "下注", "投注", "盘口", "赔率", "赌资", "黄赌毒"];
const HIGH_SIGNAL_PORNOGRAPHY_TERMS = ["包夜", "裸聊", "约炮", "招嫖", "卖淫", "嫖娼", "色情", "涉黄", "成人视频", "成人片", "成人网站", "黄色网站", "色情网站"];
const HIGH_SIGNAL_DRUG_TERMS = ["毒品", "冰毒", "大麻", "摇头丸", "贩毒", "吸毒", "涉毒"];

const COMBINATION_MAX_DISTANCE = 80;
const COMBINATION_MAX_EVIDENCE_LENGTH = 120;
const COMBINATION_MAX_ITEMS = 8;

type CombinationTermMatch = {
  term: string;
  start: number;
  end: number;
};

const CONTACT_TERM_SET = new Set(CONTACT_TERMS.map((term) => term.toLowerCase()));
const TRANSACTION_TERM_SET = new Set(TRANSACTION_TERMS.map((term) => term.toLowerCase()));
const PRICE_TERM_SET = new Set(PRICE_TERMS.map((term) => term.toLowerCase()));

const REGEX_RULES: RegexSafetyRule[] = [
  {
    id: "gambling_promotion_or_diversion",
    type: "gambling",
    severity: "high",
    confidence: 0.94,
    pattern: /(黄赌毒|诱导.{0,12}(赌博|博彩|下注|投注)|参与赌博|赌博引流|博彩引流|下注引流|投注引流|一起.{0,8}赌博|赌博.{0,8}快乐|稳定收益.{0,24}(下注|投注|进群))/g,
    reason: "疑似诱导参与赌博或赌博引流",
    suggestion: "删除赌博参与引导、下注投注、收益诱导和站外引流表达。",
  },
  {
    id: "porn_site_diversion",
    type: "pornography",
    severity: "high",
    confidence: 0.94,
    pattern: /((引流|访问|进入).{0,12}(色情网站|黄色网站|成人网站|涉黄网站)|色情网站|黄色网站|成人网站|涉黄引流)/g,
    reason: "疑似色情网站访问引导或涉黄引流",
    suggestion: "删除色情网站访问引导、涉黄描述和站外引流表达。",
  },
  {
    id: "porn_resource_sale",
    type: "pornography",
    severity: "high",
    confidence: 0.94,
    pattern: /(成人视频|成人片|成人合集|色情资源).{0,24}(低价|出售|付款|发链接|QQ|微信|vx|联系方式)/gi,
    reason: "疑似色情资源售卖或站外引流",
    suggestion: "删除色情资源售卖、付款发链和站外联系方式。",
  },
  {
    id: "privacy_phone_cn",
    type: "privacy",
    severity: "medium",
    confidence: 0.86,
    pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g,
    reason: "疑似手机号泄露",
    suggestion: "移除手机号，改为平台内或官方渠道说明。",
  },
  {
    id: "privacy_id_card_cn",
    type: "privacy",
    severity: "high",
    confidence: 0.96,
    pattern: /(?<!\d)\d{17}[\dXx](?!\d)/g,
    reason: "疑似身份证号泄露",
    suggestion: "删除身份证号等个人敏感信息。",
  },
  {
    id: "privacy_email",
    type: "privacy",
    severity: "medium",
    confidence: 0.76,
    pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    reason: "疑似邮箱等联系方式泄露",
    suggestion: "避免公开个人联系方式。",
  },
  {
    id: "privacy_bank_card",
    type: "privacy",
    severity: "high",
    confidence: 0.9,
    pattern: /(?<!\d)(?:\d[ -]?){16,19}(?!\d)/g,
    reason: "疑似银行卡号泄露",
    suggestion: "删除银行卡号等金融敏感信息。",
  },
  {
    id: "contact_wechat",
    type: "sensitive",
    severity: "medium",
    confidence: 0.8,
    pattern: /(微信|VX|vx|v信|加v|加V|私聊|联系方式)[:：\s]*[a-zA-Z0-9_-]{5,24}/g,
    reason: "疑似站外联系方式或引流表达",
    suggestion: "删除站外联系方式，改为平台内合规沟通方式。",
  },
  {
    id: "contact_qq",
    type: "sensitive",
    severity: "medium",
    confidence: 0.78,
    pattern: /(QQ|qq|企鹅)[:：\s]*[1-9]\d{4,11}/g,
    reason: "疑似 QQ 联系方式或站外引流",
    suggestion: "删除站外联系方式。",
  },
  {
    id: "url_external",
    type: "sensitive",
    severity: "medium",
    confidence: 0.72,
    pattern: /https?:\/\/[^\s，。；、?？)）]+/gi,
    reason: "疑似外链或站外引流",
    suggestion: "谨慎使用外链，必要时改为平台允许的来源说明。",
  },
  {
    id: "qr_code_guide",
    type: "sensitive",
    severity: "medium",
    confidence: 0.8,
    pattern: /(扫码.{0,8}进群|二维码.{0,8}(进群|加群)|私信进群|进群|拉群|加群|扫码|二维码)/g,
    reason: "疑似二维码或社群引流",
    suggestion: "移除二维码、拉群或私信进群等引流表达。",
  },
];

@Injectable()
export class SafetyRuleEngine {
  constructor(private readonly loader: SafetyRuleLoader) {}

  scan(input: SafetyReviewInput): SafetyRuleScanResult {
    // 加载规则词库
    const lexicons = this.loader.loadLexicons();
    // 扫描文本，生成风险项列表，包含敏感词、正则表达式规则和组合规则的命中结果
    const items = this.dedupe([
      ...this.scanLexicons("title", input.title, lexicons),
      ...this.scanLexicons("body", input.body, lexicons),
      ...this.scanRegex("title", input.title),
      ...this.scanRegex("body", input.body),
      ...this.scanCombinations("title", input.title, lexicons),
      ...this.scanCombinations("body", input.body, lexicons),
    ]);
    const riskItems = this.dedupe(items.map((item) => this.applyWhitelist(item, input)));

    return this.summarize(riskItems);
  }

  // 扫描文本中的敏感词，生成风险项列表
  private scanLexicons(field: AuditRiskField, text: string, lexicons: SafetyLexiconEntry[]) {
    const lowerText = text.toLowerCase();
    const items: AuditRiskItem[] = [];
    for (const entry of lexicons) {
      const term = entry.term;
      const lowerTerm = term.toLowerCase();
      let index = lowerText.indexOf(lowerTerm);
      while (index >= 0) {
        items.push(
          this.createItem({
            type: entry.type,
            severity: "medium",
            confidence: 0.78,
            evidence: text.slice(index, index + term.length),
            field,
            startOffset: index,
            endOffset: index + term.length,
            ruleId: entry.ruleId,
            reason: `命中${this.riskTypeLabel(entry.type)}敏感词`,
            suggestion: "请删除或改写该风险表达。",
          })
        );
        index = lowerText.indexOf(lowerTerm, index + Math.max(term.length, 1));
      }
    }
    return items;
  }

  // 扫描文本中的正则表达式规则，生成风险项列表
  private scanRegex(field: AuditRiskField, text: string) {
    const items: AuditRiskItem[] = [];
    for (const rule of REGEX_RULES) {
      const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
      for (const match of text.matchAll(pattern)) {
        const evidence = match[0];
        const startOffset = match.index ?? text.indexOf(evidence);
        if (!evidence || startOffset < 0) continue;
        items.push(
          this.createItem({
            type: rule.type,
            severity: rule.severity,
            confidence: rule.confidence,
            evidence,
            field,
            startOffset,
            endOffset: startOffset + evidence.length,
            ruleId: rule.id,
            reason: rule.reason,
            suggestion: rule.suggestion,
          })
        );
      }
    }
    return items;
  }

  // 组合规则只处理明显危险的组合场景，普通敏感词仍交给 LLM 复核后再决定是否展示。
  private scanCombinations(field: AuditRiskField, text: string, lexicons: SafetyLexiconEntry[]) {
    const items: AuditRiskItem[] = [];
    const gambling = this.uniqueTerms([
      ...lexicons.filter((entry) => entry.type === "gambling").map((entry) => entry.term),
      ...HIGH_SIGNAL_GAMBLING_TERMS,
    ]);
    const drug = this.uniqueTerms([
      ...lexicons.filter((entry) => entry.type === "drug").map((entry) => entry.term),
      ...HIGH_SIGNAL_DRUG_TERMS,
    ]);
    const pornography = this.uniqueTerms([
      ...lexicons.filter((entry) => entry.type === "pornography").map((entry) => entry.term),
      ...HIGH_SIGNAL_PORNOGRAPHY_TERMS,
    ]);
    const pornPriceOrContact = this.uniqueTerms([...PRICE_TERMS, ...CONTACT_TERMS, ...TRANSACTION_TERMS]);

    items.push(
      ...this.matchCombination(field, text, gambling, CONTACT_TERMS, "gambling", "combo:gambling_contact", "赌博词与站外联系方式组合出现，疑似赌博引流"),
      ...this.matchCombination(field, text, drug, TRANSACTION_TERMS, "drug", "combo:drug_transaction", "涉毒词与交易表达组合出现，疑似涉毒交易"),
      ...this.matchCombination(field, text, pornography, pornPriceOrContact, "pornography", "combo:porn_price_contact", "色情词与价格或联系方式组合出现，疑似色情交易或引流")
    );

    return items;
  }

  private matchCombination(
    field: AuditRiskField,
    text: string,
    firstTerms: string[],
    secondTerms: string[],
    type: Exclude<AuditRiskType, "none">,
    ruleId: string,
    reason: string
  ) {
    return this.matchNearbyCombinations(field, text, firstTerms, secondTerms, type, ruleId, reason);
  }

  private matchNearbyCombinations(
    field: AuditRiskField,
    text: string,
    firstTerms: string[],
    secondTerms: string[],
    type: Exclude<AuditRiskType, "none">,
    ruleId: string,
    reason: string
  ) {
    const lowerText = text.toLowerCase();
    const firstMatches = this.findTermMatches(text, lowerText, firstTerms);
    const secondMatches = this.findTermMatches(text, lowerText, secondTerms);
    const candidates: Array<{
      gap: number;
      signalWeight: number;
      startOffset: number;
      endOffset: number;
      evidence: string;
    }> = [];

    for (const first of firstMatches) {
      for (const second of secondMatches) {
        if (first.start === second.start && first.end === second.end) continue;

        const gap = this.combinationGap(first, second);
        if (gap > COMBINATION_MAX_DISTANCE) continue;

        const startOffset = Math.min(first.start, second.start);
        const endOffset = Math.max(first.end, second.end);
        if (endOffset - startOffset > COMBINATION_MAX_EVIDENCE_LENGTH) continue;

        candidates.push({
          gap,
          signalWeight: this.combinationSignalWeight(second.term),
          startOffset,
          endOffset,
          evidence: text.slice(startOffset, endOffset),
        });
      }
    }

    const seen = new Set<string>();
    return candidates
      .sort((a, b) => {
        if (a.signalWeight !== b.signalWeight) return b.signalWeight - a.signalWeight;
        if (a.gap !== b.gap) return a.gap - b.gap;
        return a.evidence.length - b.evidence.length;
      })
      .filter((candidate) => {
        const key = `${candidate.startOffset}:${candidate.endOffset}:${candidate.evidence}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, COMBINATION_MAX_ITEMS)
      .map((candidate) =>
        this.createItem({
          type,
          severity: "high",
          confidence: candidate.signalWeight >= 3 ? 0.95 : 0.94,
          evidence: candidate.evidence,
          field,
          startOffset: candidate.startOffset,
          endOffset: candidate.endOffset,
          ruleId,
          reason,
          suggestion: "\u5220\u9664\u9ad8\u98ce\u9669\u5f15\u6d41\u3001\u4ea4\u6613\u3001\u8054\u7cfb\u65b9\u5f0f\u6216\u6536\u76ca\u8bf1\u5bfc\u8868\u8fbe\u3002",
        })
      );
  }

  private findTermMatches(text: string, lowerText: string, terms: string[]): CombinationTermMatch[] {
    const matches: CombinationTermMatch[] = [];
    const uniqueTerms = Array.from(new Set(terms.map((term) => term.trim()).filter(Boolean)));

    for (const term of uniqueTerms) {
      const lowerTerm = term.toLowerCase();
      let index = lowerText.indexOf(lowerTerm);
      while (index >= 0) {
        const end = this.expandContactMatch(text, term, index + term.length);
        matches.push({ term, start: index, end });
        index = lowerText.indexOf(lowerTerm, index + Math.max(lowerTerm.length, 1));
      }
    }

    return matches.sort((a, b) => a.start - b.start || a.end - b.end);
  }

  private expandContactMatch(text: string, term: string, end: number) {
    if (!this.isContactTerm(term)) return end;

    const tail = text.slice(end, Math.min(text.length, end + 32));
    const account = tail.match(/^[\s:：_-]*[a-zA-Z0-9][a-zA-Z0-9_-]{3,23}/);
    return account ? end + account[0].length : end;
  }

  private isContactTerm(term: string) {
    return CONTACT_TERM_SET.has(term.toLowerCase());
  }

  private combinationSignalWeight(term: string) {
    const normalized = term.toLowerCase();
    if (CONTACT_TERM_SET.has(normalized)) return 3;
    if (TRANSACTION_TERM_SET.has(normalized) || PRICE_TERM_SET.has(normalized)) return 2;
    return 1;
  }

  private combinationGap(first: CombinationTermMatch, second: CombinationTermMatch) {
    if (first.end <= second.start) return second.start - first.end;
    if (second.end <= first.start) return first.start - second.end;
    return 0;
  }

  private uniqueTerms(terms: string[]) {
    return Array.from(new Set(terms.map((term) => term.trim()).filter(Boolean)));
  }

  private applyWhitelist(item: AuditRiskItem, input: SafetyReviewInput): AuditRiskItem {
    const text = item.field === "title" ? input.title : input.body;
    const start = item.startOffset ?? text.indexOf(item.evidence);
    if (start < 0) return item;
    const context = text.slice(Math.max(0, start - 24), Math.min(text.length, start + item.evidence.length + 24));
    const hasWhitelist = WHITELIST_CONTEXT_TERMS.some((term) => context.includes(term));
    if (!hasWhitelist || item.severity === "low" || item.severity === "high") return item;

    return {
      ...item,
      confidence: Math.min(item.confidence, 0.56),
      ruleId: `${item.ruleId}:context-whitelist`,
      reason: `${item.reason}；上下文包含科普/提醒语境，需模型复核`,
      suggestion: item.suggestion ?? "保留科普提醒语境，避免提供操作方法或引流信息。",
    };
  }

  private summarize(riskItems: AuditRiskItem[]): SafetyRuleScanResult {
    const blockingItems = riskItems.filter((item) => item.severity === "medium" || item.severity === "high");
    const riskTypes = Array.from(new Set(blockingItems.map((item) => item.type))).filter((type) => type !== "none");
    const categoryScores = Object.fromEntries(
      SAFETY_RISK_TYPES.map((type) => [
        type,
        Math.max(0, ...riskItems.filter((item) => item.type === type).map((item) => item.confidence)),
      ])
    );
    const riskLevel = riskItems.some((item) => item.severity === "high")
      ? AuditRiskLevel.High
      : riskItems.some((item) => item.severity === "medium")
        ? AuditRiskLevel.Medium
        : AuditRiskLevel.Low;

    return {
      riskItems,
      riskTypes: riskTypes.length ? riskTypes : ["none"],
      riskLevel,
      categoryScores,
    };
  }

  private dedupe(items: AuditRiskItem[]) {
    const sorted = [...items].sort((a, b) => {
      const severityDiff = this.severityWeight(b.severity) - this.severityWeight(a.severity);
      if (severityDiff !== 0) return severityDiff;
      const confidenceDiff = b.confidence - a.confidence;
      if (confidenceDiff !== 0) return confidenceDiff;
      return a.evidence.length - b.evidence.length;
    });
    const output: AuditRiskItem[] = [];

    for (const item of sorted) {
      const index = output.findIndex((current) => this.isSameOrOverlappingRisk(current, item));
      if (index >= 0) {
        output[index] = this.mergeOverlappingItem(output[index], item);
      } else {
        output.push(item);
      }
    }

    return output.sort((a, b) => {
      if ((a.field ?? "") !== (b.field ?? "")) return (a.field ?? "").localeCompare(b.field ?? "");
      return (a.startOffset ?? 0) - (b.startOffset ?? 0);
    });
  }

  private isSameOrOverlappingRisk(a: AuditRiskItem, b: AuditRiskItem) {
    if (a.type !== b.type || a.field !== b.field) return false;
    if (a.startOffset === undefined || a.endOffset === undefined || b.startOffset === undefined || b.endOffset === undefined) {
      return a.evidence === b.evidence;
    }
    return a.startOffset < b.endOffset && b.startOffset < a.endOffset;
  }

  private mergeOverlappingItem(a: AuditRiskItem, b: AuditRiskItem): AuditRiskItem {
    const winner = this.preferItem(a, b);
    return {
      ...winner,
      confidence: Math.max(a.confidence, b.confidence),
      severity: this.higherSeverity(a.severity, b.severity),
      reason: this.joinUnique([a.reason, b.reason]),
      suggestion: winner.suggestion ?? a.suggestion ?? b.suggestion,
      ruleId: winner.ruleId ?? a.ruleId ?? b.ruleId,
    };
  }

  private preferItem(a: AuditRiskItem, b: AuditRiskItem) {
    const severityDiff = this.severityWeight(a.severity) - this.severityWeight(b.severity);
    if (severityDiff !== 0) return severityDiff > 0 ? a : b;
    if (a.confidence !== b.confidence) return a.confidence > b.confidence ? a : b;
    return a.evidence.length <= b.evidence.length ? a : b;
  }

  private createItem(input: Omit<AuditRiskItem, "id" | "source">): AuditRiskItem {
    return {
      id: `rule_${this.hash(`${input.ruleId}:${input.field}:${input.startOffset}:${input.evidence}`)}`,
      source: "rule",
      ...input,
      confidence: this.clamp(input.confidence),
    };
  }

  private riskTypeLabel(type: AuditRiskType) {
    const labels: Record<AuditRiskType, string> = {
      pornography: "涉黄",
      gambling: "涉赌",
      drug: "涉毒",
      sensitive: "敏感",
      vulgar: "低俗",
      privacy: "隐私",
      illegal: "违法",
      fraud: "诈骗",
      minor: "未成年人",
      none: "无风险",
    };
    return labels[type];
  }

  private higherSeverity(a: AuditRiskSeverity, b: AuditRiskSeverity): AuditRiskSeverity {
    return this.severityWeight(a) >= this.severityWeight(b) ? a : b;
  }

  private severityWeight(severity: AuditRiskSeverity) {
    return severity === "high" ? 3 : severity === "medium" ? 2 : 1;
  }

  private joinUnique(values: string[]) {
    return Array.from(new Set(values.filter(Boolean))).join("；");
  }

  private clamp(value: number) {
    if (!Number.isFinite(value)) return 0;
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
