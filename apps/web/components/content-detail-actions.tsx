"use client";

import { useEffect, useState } from "react";
import { trackAnalytics } from "../lib/api";

export function ContentDetailActions({
  contentId,
  title,
}: {
  contentId: string;
  title: string;
}) {
  const [status, setStatus] = useState("内容已打开");

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
    setStatus("正在处理...");

    try {
      await trackAnalytics({ contentId, eventType, metadata: { title } });
      setStatus(eventType === "like" ? "已点赞" : "已收藏");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "操作失败");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <button className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600" type="button" onClick={() => handleEvent("collect")}>
          收藏
        </button>
        <button className="rounded-full bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700" type="button" onClick={() => handleEvent("like")}>
          点赞
        </button>
      </div>
      <p className="text-xs font-medium text-slate-400">{status}</p>
    </div>
  );
}
