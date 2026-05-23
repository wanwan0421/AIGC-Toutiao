"use client";

import { useEffect, useState } from "react";
import { trackAnalytics } from "../lib/api";

export function ContentDetailActions({
  contentId,
  title,
  initialLikeCount,
  initialViewCount,
}: {
  contentId: string;
  title: string;
  initialLikeCount: number;
  initialViewCount: number;
}) {
  const [likeCount, setLikeCount] = useState(initialLikeCount);
  const [viewCount, setViewCount] = useState(initialViewCount);
  const [status, setStatus] = useState("已接入后端行为统计");

  useEffect(() => {
    let cancelled = false;

    async function recordView() {
      try {
        const response = await trackAnalytics({ contentId, eventType: "view", metadata: { title } });
        if (!cancelled) {
          setViewCount(response.counters.viewCount);
          setLikeCount(response.counters.likeCount);
          setStatus("已记录浏览行为到后端");
        }
      } catch {
        if (!cancelled) {
          setStatus("浏览事件记录失败");
        }
      }
    }

    void recordView();

    return () => {
      cancelled = true;
    };
  }, [contentId, title]);

  async function handleEvent(eventType: "like" | "collect") {
    setStatus("正在写入后端...");

    try {
      const response = await trackAnalytics({ contentId, eventType, metadata: { title } });
      setViewCount(response.counters.viewCount);
      setLikeCount(response.counters.likeCount);
      setStatus(eventType === "like" ? "点赞已写入数据库" : "收藏已写入数据库");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "操作失败");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <button className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-50" type="button" onClick={() => handleEvent("collect")}>
          收藏
        </button>
        <button className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-black text-white transition hover:bg-blue-800" type="button" onClick={() => handleEvent("like")}>
          点赞
        </button>
      </div>
      <p className="text-xs font-medium text-slate-400">
        浏览 {viewCount} · 点赞 {likeCount} · {status}
      </p>
    </div>
  );
}
