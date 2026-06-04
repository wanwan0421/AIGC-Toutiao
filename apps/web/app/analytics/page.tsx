"use client";

import { useEffect, useMemo, useState } from "react";
import { ContentStatus, type ContentSummary } from "@aicp/shared";
import { getContents } from "../../lib/api";

function compactNumber(value: number) {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return value.toLocaleString();
}

export default function AnalyticsPage() {
  const [contents, setContents] = useState<ContentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const items = await getContents();
        if (!cancelled) setContents(items);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "数据加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    const totalViews = contents.reduce((sum, item) => sum + item.viewCount, 0);
    const totalLikes = contents.reduce((sum, item) => sum + item.likeCount, 0);
    const totalCollects = contents.reduce((sum, item) => sum + (item.collectCount ?? 0), 0);
    const publishedCount = contents.filter((item) =>
      [ContentStatus.Published, ContentStatus.Updated, ContentStatus.Approved].includes(item.status)
    ).length;
    const averageQuality = contents.length ? contents.reduce((sum, item) => sum + item.qualityScore, 0) / contents.length : 0;
    const topContents = [...contents].sort((left, right) => right.heatScore - left.heatScore).slice(0, 5);
    return { totalViews, totalLikes, totalCollects, publishedCount, averageQuality, topContents };
  }, [contents]);

  return (
    <div className="mx-auto max-w-350 w-full px-4 py-5 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="m-0 text-2xl font-black text-slate-900">数据中心</h1>
        </div>
        <span className="rounded-full border border-slate-200 bg-white px-6 py-2.5 text-sm font-semibold text-emerald-700">
          数据实时更新
        </span>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm font-semibold text-slate-500">正在加载数据...</div>
      ) : error ? (
        <div className="rounded-2xl bg-rose-50 p-5 text-sm font-semibold text-rose-600">{error}</div>
      ) : (
        <>
          <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-4">
            <MetricCard label="累计阅读" value={compactNumber(stats.totalViews)} />
            <MetricCard label="总点赞" value={compactNumber(stats.totalLikes)} />
            <MetricCard label="总收藏" value={compactNumber(stats.totalCollects)} />
            <MetricCard label="已发布作品" value={String(stats.publishedCount)} />
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="m-0 text-xl font-black text-slate-950">热门内容</h2>
            <div className="mt-5 grid gap-3">
              {stats.topContents.map((item, index) => (
                <article key={item.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-100 p-4">
                  <div className="min-w-0">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="grid h-7 w-7 place-items-center rounded-lg bg-rose-50 text-sm font-black text-rose-600">
                        {index + 1}
                      </span>
                      <span className="text-xs font-bold text-slate-400">{item.status}</span>
                    </div>
                    <h3 className="truncate text-base font-black text-slate-950">{item.title}</h3>
                    <p className="mt-1 line-clamp-1 text-sm text-slate-500">{item.excerpt}</p>
                  </div>
                  <div className="grid grid-cols-4 gap-5 text-right">
                    <SmallMetric label="质量" value={item.qualityScore} />
                    <SmallMetric label="热度" value={item.heatScore} />
                    <SmallMetric label="阅读" value={item.viewCount} />
                    <SmallMetric label="收藏" value={item.collectCount ?? 0} />
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-bold text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-black text-slate-950">{value}</p>
    </div>
  );
}

function SmallMetric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs font-bold text-slate-400">{label}</div>
      <div className="text-lg font-black text-slate-950">{value}</div>
    </div>
  );
}
