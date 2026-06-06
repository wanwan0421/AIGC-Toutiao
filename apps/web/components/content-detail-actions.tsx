"use client";

import { useEffect, useState } from "react";
import type { ContentReactionToggleResult, ContentViewerState } from "@aicp/shared";
import { toggleContentReaction, trackAnalytics } from "../lib/api";

export function ContentDetailActions({
  contentId,
  title,
  viewerState,
  onReactionChange,
}: {
  contentId: string;
  title: string;
  viewerState?: ContentViewerState;
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
      try {
        const response = await trackAnalytics({ contentId, eventType: "view", metadata: { title } });
        if (!cancelled) {
          setStatus(response.ok ? "已记录浏览" : "内容已打开");
        }
      } catch {
        if (!cancelled) {
          setStatus("内容已打开");
        }
      }
    }

    void recordView();

    return () => {
      cancelled = true;
    };
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <button
          className={`rounded-full border px-5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
            collected
              ? "border-rose-200 bg-rose-50 text-rose-600"
              : "border-slate-200 bg-white text-slate-700 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
          }`}
          type="button"
          disabled={Boolean(busy)}
          onClick={() => handleEvent("collect")}
        >
          {busy === "collect" ? "处理中..." : collected ? "已收藏" : "收藏"}
        </button>
        <button
          className={`rounded-full px-5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
            liked ? "bg-rose-100 text-rose-700" : "bg-rose-600 text-white hover:bg-rose-700"
          }`}
          type="button"
          disabled={Boolean(busy)}
          onClick={() => handleEvent("like")}
        >
          {busy === "like" ? "处理中..." : liked ? "已点赞" : "点赞"}
        </button>
      </div>
      <p className="text-xs font-semibold text-slate-400">{status}</p>
    </div>
  );
}
