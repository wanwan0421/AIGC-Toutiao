import { ContentStatus, type ContentDetail, type ContentSummary } from "@aicp/shared";

export const mockAuthor = {
  id: "user_001",
  nickname: "Luna Studio",
  avatarUrl: ""
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

export const mockDetail: ContentDetail = {
  ...mockContents[0],
  body:
    "这篇内容由创作者提供穿搭素材和目标人群，AI 先生成标题、封面文案和正文结构，再经过人工补充体验细节。发布前重点检查表达是否真实、建议是否可执行、图片是否清晰。\n\n核心建议包括选择透气面料、统一低饱和配色、准备一件空调房外套、用轻量鞋包提高通勤舒适度，并把每一套搭配拆成可复用公式，方便读者收藏和迁移到自己的衣橱。",
  tags: ["通勤", "穿搭", "短图文"],
  assets: [
    {
      id: "asset_001",
      fileName: "cover.jpg",
      mimeType: "image/jpeg",
      url: "/placeholder-cover.jpg",
      auditStatus: "approved"
    }
  ]
};
