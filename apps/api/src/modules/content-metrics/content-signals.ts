export const RECENT_CONTENT_SIGNAL_WINDOW_DAYS = 7;

// 近期行为权重
export const RECENT_CONTENT_ACTION_WEIGHTS: Record<string, number> = {
  view: 1,
  like: 2.5,
  collect: 3,
  comment: 3,
  like_cancel: -2.5,
  collect_cancel: -3,
};

// 累积互动权重
const CUMULATIVE_ENGAGEMENT_WEIGHTS = {
  like: 2,
  collect: 3,
  comment: 3,
} as const;

export type ContentSignalCounters = {
  viewCount: number;
  likeCount: number;
  collectCount: number;
  commentCount?: number | null;
  _count?: {
    comments?: number | null;
  } | null;
};

export function recentContentActionWeight(eventType: string) {
  return RECENT_CONTENT_ACTION_WEIGHTS[eventType] ?? 0;
}

export function contentViewSignal(content: Pick<ContentSignalCounters, "viewCount">) {
  return Math.log1p(Math.max(0, content.viewCount));
}

export function contentEngagementSignal(content: ContentSignalCounters) {
  const commentCount = content._count?.comments ?? content.commentCount ?? 0;
  return (
    Math.log1p(Math.max(0, content.likeCount)) * CUMULATIVE_ENGAGEMENT_WEIGHTS.like +
    Math.log1p(Math.max(0, content.collectCount)) * CUMULATIVE_ENGAGEMENT_WEIGHTS.collect +
    Math.log1p(Math.max(0, commentCount)) * CUMULATIVE_ENGAGEMENT_WEIGHTS.comment
  );
}

export function normalizeSignal(value: number, max: number) {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(value / max, 1));
}
