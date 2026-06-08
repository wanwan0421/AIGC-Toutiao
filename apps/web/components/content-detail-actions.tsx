"use client";

import { useEffect, useState } from "react";
import type React from "react";
import type { ContentReactionToggleResult, ContentViewerState } from "@aicp/shared";
import { Bookmark, Eye, Flame, Heart } from "lucide-react";
import { toggleContentReaction, trackAnalytics } from "../lib/api";

type InteractionMetrics = {
  viewCount: number;
  likeCount: number;
  collectCount: number;
  heatScore: number;
};

type ActionVariant = "inline" | "rail";
const VIEW_STORAGE_PREFIX = "aicp:viewed-content:";
const VIEW_DEDUPE_MS = 30 * 60 * 1000;

export function ContentDetailActions({
  contentId,
  title,
  viewerState,
  metrics,
  variant = "inline",
  onMetricsChange,
  onReactionChange,
}: {
  contentId: string;
  title: string;
  viewerState?: ContentViewerState;
  metrics: InteractionMetrics;
  variant?: ActionVariant;
  onMetricsChange?: (metrics: InteractionMetrics) => void;
  onReactionChange?: (result: ContentReactionToggleResult) => void;
}) {
  const [status, setStatus] = useState("内容已打开");
  const [liked, setLiked] = useState(Boolean(viewerState?.liked));
  const [collected, setCollected] = useState(Boolean(viewerState?.collected));
  const [busy, setBusy] = useState<"like" | "collect" | null>(null);

  useEffect(() => {
    setLiked(Boolean(viewerState?.liked));
    setCollected(Boolean(viewerState?.collected));
  }, [viewerState?.liked, viewerState?.collected]);

  useEffect(() => {
    let cancelled = false;

    async function recordView() {
      const storageKey = `${VIEW_STORAGE_PREFIX}${contentId}`;
      const now = Date.now();
      const lastViewedAt = Number(window.sessionStorage.getItem(storageKey) ?? 0);
      if (Number.isFinite(lastViewedAt) && now - lastViewedAt < VIEW_DEDUPE_MS) {
        setStatus("内容已打开");
        return;
      }
      window.sessionStorage.setItem(storageKey, String(now));

      try {
        const response = await trackAnalytics({ contentId, eventType: "view", metadata: { title } });
        if (!cancelled) {
          setStatus(response.ok ? "已记录浏览" : "内容已打开");
          onMetricsChange?.(response.counters);
        }
      } catch {
        window.sessionStorage.removeItem(storageKey);
        if (!cancelled) setStatus("内容已打开");
      }
    }

    void recordView();

    return () => {
      cancelled = true;
    };
    // View tracking should run once per content/title pair; the callback only mirrors counters into parent state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentId, title]);

  async function handleEvent(eventType: "like" | "collect") {
    if (busy) return;
    setBusy(eventType);
    setStatus("正在处理...");

    try {
      const result = await toggleContentReaction(contentId, eventType);
      if (eventType === "like") setLiked(result.active);
      else setCollected(result.active);
      onReactionChange?.(result);
      setStatus(eventType === "like" ? (result.active ? "已点赞" : "已取消点赞") : result.active ? "已收藏" : "已取消收藏");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(null);
    }
  }

  if (variant === "rail") {
    return (
      <div className="flex w-16 flex-col items-center gap-3">
        <RailButton
          active={liked}
          disabled={Boolean(busy)}
          icon={<Heart className="h-5 w-5" />}
          label={busy === "like" ? "处理中" : liked ? "已赞" : "点赞"}
          value={metrics.likeCount}
          onClick={() => void handleEvent("like")}
        />
        <RailButton
          active={collected}
          disabled={Boolean(busy)}
          icon={<Bookmark className="h-5 w-5" />}
          label={busy === "collect" ? "处理中" : collected ? "已藏" : "收藏"}
          value={metrics.collectCount}
          onClick={() => void handleEvent("collect")}
        />
        <RailMetric icon={<Eye className="h-5 w-5" />} label="阅读" value={metrics.viewCount} />
        <RailMetric icon={<Flame className="h-5 w-5" />} label="热度" value={metrics.heatScore} />
        <span className="sr-only" aria-live="polite">
          {status}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <InlineButton
          active={liked}
          disabled={Boolean(busy)}
          icon={<Heart className="h-4 w-4" />}
          onClick={() => void handleEvent("like")}
        >
          {busy === "like" ? "处理中..." : liked ? "已点赞" : "点赞"} · {metrics.likeCount.toLocaleString()}
        </InlineButton>
        <InlineButton
          active={collected}
          disabled={Boolean(busy)}
          icon={<Bookmark className="h-4 w-4" />}
          onClick={() => void handleEvent("collect")}
        >
          {busy === "collect" ? "处理中..." : collected ? "已收藏" : "收藏"} · {metrics.collectCount.toLocaleString()}
        </InlineButton>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-600">
          <Eye className="h-4 w-4" />
          阅读 · {metrics.viewCount.toLocaleString()}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-600">
          <Flame className="h-4 w-4" />
          热度 · {metrics.heatScore.toLocaleString()}
        </span>
      </div>
      <p className="text-xs font-semibold text-slate-400">{status}</p>
    </div>
  );
}

function InlineButton({
  active,
  disabled,
  icon,
  children,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-full border px-5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
        active
          ? "border-rose-200 bg-rose-50 text-rose-600"
          : "border-slate-200 bg-white text-slate-700 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
      }`}
      type="button"
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  );
}

function RailButton({
  active,
  disabled,
  icon,
  label,
  value,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  icon: React.ReactNode;
  label: string;
  value: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full flex-col items-center gap-1 rounded-full border px-2 py-3 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${
        active
          ? "border-rose-200 bg-rose-50 text-rose-600"
          : "border-slate-200 bg-white text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
      }`}
    >
      {icon}
      <span className="text-[11px] text-slate-400">{compact(value)}</span>
    </button>
  );
}

function RailMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex w-full flex-col items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-3 text-xs font-bold text-slate-600">
      {icon}
      <span className="text-[11px] text-slate-400">{compact(value)}</span>
    </div>
  );
}

function compact(value: number) {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return value.toLocaleString();
}
