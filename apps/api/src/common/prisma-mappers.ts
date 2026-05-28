import {
  AssetAuditStatus as DbAssetAuditStatus,
  AuditRiskLevel as DbAuditRiskLevel,
  ContentStatus as DbContentStatus,
  PromptScene as DbPromptScene
} from "@prisma/client";
import {
  AuditRiskLevel,
  ContentStatus,
  PromptScene,
  type AssetSummary,
  type ContentDetail,
  type ContentSummary
} from "@aicp/shared";

type UserLike = {
  id: string;
  nickname: string;
  avatarUrl: string | null;
};

type ContentLike = {
  id: string;
  title: string;
  body: string;
  excerpt: string | null;
  status: DbContentStatus;
  tags: string[];
  qualityScore: number;
  heatScore: number;
  viewCount: number;
  likeCount: number;
  publishedAt: Date | null;
  updatedAt: Date;
  author: UserLike;
};

type AssetLike = {
  id: string;
  fileName: string;
  mimeType: string;
  url: string;
  auditStatus: DbAssetAuditStatus;
  source?: string;
  metadata?: unknown;
};

type ContentAssetLike = {
  asset: AssetLike;
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
    source: asset.source,
    metadata: asset.metadata && typeof asset.metadata === "object" ? (asset.metadata as Record<string, unknown>) : undefined
  };
}

export function toContentSummary(content: ContentLike): ContentSummary {
  return {
    id: content.id,
    title: content.title,
    excerpt: content.excerpt ?? content.body.slice(0, 72),
    status: toApiContentStatus(content.status),
    author: {
      id: content.author.id,
      nickname: content.author.nickname,
      avatarUrl: content.author.avatarUrl ?? undefined
    },
    qualityScore: content.qualityScore,
    heatScore: content.heatScore,
    viewCount: content.viewCount,
    likeCount: content.likeCount,
    publishedAt: content.publishedAt?.toISOString(),
    updatedAt: content.updatedAt.toISOString()
  };
}

export function toContentDetail(content: ContentLike & { assets: ContentAssetLike[] }): ContentDetail {
  return {
    ...toContentSummary(content),
    body: content.body,
    tags: content.tags,
    assets: content.assets.map((item) => toAssetSummary(item.asset))
  };
}
