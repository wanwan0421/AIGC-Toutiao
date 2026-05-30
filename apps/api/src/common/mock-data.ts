import {
  AuditRiskLevel,
  ContentStatus,
  type AiGenerateResult,
  type AuditResult,
  type ContentSummary,
  type QualityScoreResult
} from "@aicp/shared";

export const mockAuthor = {
  id: "user_001",
  nickname: "Luna Studio"
};

export const mockContents: ContentSummary[] = [
  {
    id: "content_001",
    title: "夏日通勤穿搭的 5 个轻量公式",
    excerpt: "围绕舒适、清爽、易复用三条线，生成适合短图文平台的种草内容。",
    coverUrl: "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80",
    status: ContentStatus.Published,
    author: mockAuthor,
    qualityScore: 91,
    heatScore: 86,
    viewCount: 12840,
    likeCount: 928,
    collectCount: 416,
    publishedAt: "2026-05-20T08:30:00.000Z",
    updatedAt: "2026-05-20T08:30:00.000Z"
  },
  {
    id: "content_002",
    title: "AI 辅助整理露营装备清单",
    excerpt: "从人群、预算和天气出发，拆成封面、正文、标签和发布摘要。",
    coverUrl: "https://images.unsplash.com/photo-1504851149312-7a075b496cc7?auto=format&fit=crop&w=900&q=80",
    status: ContentStatus.PendingReview,
    author: mockAuthor,
    qualityScore: 84,
    heatScore: 63,
    viewCount: 3520,
    likeCount: 214,
    collectCount: 98,
    updatedAt: "2026-05-21T03:16:00.000Z"
  },
  {
    id: "content_003",
    title: "新手咖啡器具选购指南",
    excerpt: "用 AI 生成结构，再由创作者补充个人体验与图片素材。",
    coverUrl: "https://images.unsplash.com/photo-1442512595331-e89e73853f31?auto=format&fit=crop&w=900&q=80",
    status: ContentStatus.Draft,
    author: mockAuthor,
    qualityScore: 0,
    heatScore: 0,
    viewCount: 0,
    likeCount: 0,
    collectCount: 0,
    updatedAt: "2026-05-21T06:45:00.000Z"
  },
  {
    id: "content_004",
    title: "城市微旅行：半天完成一篇可发布攻略",
    excerpt: "把路线、预算、拍照点和避坑提醒组合成读者可直接收藏的城市指南。",
    coverUrl: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80",
    status: ContentStatus.Approved,
    author: mockAuthor,
    qualityScore: 89,
    heatScore: 74,
    viewCount: 6788,
    likeCount: 463,
    collectCount: 256,
    updatedAt: "2026-05-21T07:20:00.000Z"
  },
  {
    id: "content_005",
    title: "低预算桌面改造清单",
    excerpt: "从素材图片中识别物品层级，生成适合种草平台的封面标题和正文结构。",
    coverUrl: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80",
    status: ContentStatus.Rejected,
    author: mockAuthor,
    qualityScore: 72,
    heatScore: 41,
    viewCount: 980,
    likeCount: 57,
    collectCount: 22,
    updatedAt: "2026-05-21T08:02:00.000Z"
  }
];

export const mockGenerateResult: AiGenerateResult = {
  title: "夏日通勤穿搭的 5 个轻量公式",
  body:
    "从清爽面料、低饱和配色、通勤鞋包、空调房外套和可复用单品五个角度，组织一篇短图文种草内容。",
  tags: ["通勤", "穿搭", "夏日"],
  coverSuggestion: "使用浅色背景，突出一套完整通勤搭配和三条关键词。"
};

export const mockAuditResult: AuditResult = {
  passed: true,
  riskLevel: AuditRiskLevel.Low,
  riskTypes: ["none"],
  reasons: ["未发现高危合规风险。"],
  rewriteAvailable: false
};

export const mockQualityScore: QualityScoreResult = {
  total: 88,
  dimensions: {
    structure: 18,
    clarity: 17,
    value: 18,
    attraction: 17,
    compliance: 18
  },
  reason: "内容结构完整，表达清晰，具备一定实用价值。"
};
