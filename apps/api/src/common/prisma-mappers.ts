import {
  AssetAuditStatus as DbAssetAuditStatus,
  AuditRiskLevel as DbAuditRiskLevel,
  ContentStatus as DbContentStatus,
  ContentVisibility as DbContentVisibility,
  PromptScene as DbPromptScene
} from "@prisma/client";
import {
  AuditRiskLevel,
  ContentStatus,
  PromptScene,
  type AssetSummary,
  type ContentCommentSummary,
  type ContentDetail,
  type ContentSummary
} from "@aicp/shared";

type UserLike = {
  id: string;
  accountNo?: number | null;
  nickname: string;
  avatarUrl: string | null;
};

type ContentLike = {
  id: string;
  title: string;
  body: string;
  bodyHtml?: string | null;
  bodyJson?: unknown;
  excerpt: string | null;
  status: DbContentStatus;
  visibility: DbContentVisibility;
  tags: string[];
  qualityScore: number;
  heatScore: number;
  viewCount: number;
  likeCount: number;
  collectCount: number;
  createdAt: Date;
  publishedAt: Date | null;
  scheduledAt?: Date | null;
  updatedAt: Date;
  author: UserLike;
  assets?: ContentAssetLike[];
  _count?: {
    comments?: number;
  };
};

type AssetLike = {
  id: string;
  fileName: string;
  mimeType: string;
  url: string;
  auditStatus: DbAssetAuditStatus;
  auditReason?: string | null;
  riskLevel?: string | null;
  riskTypes?: string[];
  createdAt?: Date;
  source?: string;
  metadata?: unknown;
};

type ContentAssetLike = {
  asset: AssetLike;
};

type ContentCommentLike = {
  id: string;
  contentId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  author: UserLike;
};

export function toDbContentStatus(status: ContentStatus | string): DbContentStatus {
  return status as DbContentStatus;
}

export function toApiContentStatus(status: DbContentStatus): ContentStatus {
  return status as ContentStatus;
}

export function toDbPromptScene(scene: PromptScene | string): DbPromptScene {
  return scene as DbPromptScene;
}

export function toApiPromptScene(scene: DbPromptScene): PromptScene {
  return scene as PromptScene;
}

export function toDbAuditRiskLevel(level: AuditRiskLevel): DbAuditRiskLevel {
  return level as unknown as DbAuditRiskLevel;
}

export function toAssetSummary(asset: AssetLike): AssetSummary {
  return {
    id: asset.id,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    url: asset.url,
    auditStatus: asset.auditStatus,
    auditReason: asset.auditReason ?? undefined,
    riskLevel: (asset.riskLevel as AssetSummary["riskLevel"]) ?? undefined,
    riskTypes: asset.riskTypes ?? undefined,
    createdAt: asset.createdAt?.toISOString(),
    source: asset.source,
    metadata: asset.metadata && typeof asset.metadata === "object" ? (asset.metadata as Record<string, unknown>) : undefined
  };
}

export function toContentSummary(content: ContentLike): ContentSummary {
  const coverAsset = content.assets?.find((item) => item.asset.mimeType.startsWith("image/"))?.asset ?? content.assets?.[0]?.asset;
  return {
    id: content.id,
    title: content.title,
    excerpt: content.excerpt ?? content.body.slice(0, 72),
    coverUrl: coverAsset?.url,
    status: toApiContentStatus(content.status),
    visibility: content.visibility,
    author: {
      id: content.author.id,
      accountNo: content.author.accountNo ?? undefined,
      nickname: content.author.nickname,
      avatarUrl: content.author.avatarUrl ?? undefined
    },
    qualityScore: content.qualityScore,
    heatScore: content.heatScore,
    viewCount: content.viewCount,
    likeCount: content.likeCount,
    collectCount: content.collectCount,
    commentCount: content._count?.comments,
    createdAt: content.createdAt.toISOString(),
    publishedAt: content.publishedAt?.toISOString(),
    scheduledAt: content.scheduledAt?.toISOString(),
    updatedAt: content.updatedAt.toISOString()
  };
}

export function toContentDetail(content: ContentLike & { assets: ContentAssetLike[] }): ContentDetail {
  const bodyJson =
    content.bodyJson && typeof content.bodyJson === "object" && !Array.isArray(content.bodyJson)
      ? (content.bodyJson as Record<string, unknown>)
      : null;

  return {
    ...toContentSummary(content),
    body: content.body,
    bodyHtml: content.bodyHtml ?? null,
    bodyJson,
    tags: content.tags,
    assets: content.assets.map((item) => toAssetSummary(item.asset))
  };
}

export function toContentCommentSummary(comment: ContentCommentLike): ContentCommentSummary {
  return {
    id: comment.id,
    contentId: comment.contentId,
    body: comment.body,
    author: {
      id: comment.author.id,
      accountNo: comment.author.accountNo ?? undefined,
      nickname: comment.author.nickname,
      avatarUrl: comment.author.avatarUrl ?? undefined
    },
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString()
  };
}
