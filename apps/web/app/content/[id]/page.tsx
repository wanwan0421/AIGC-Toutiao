"use client";

import { useEffect, useState } from "react";
import type { ContentDetail } from "@aicp/shared";
import { ContentDetailActions } from "../../../components/content-detail-actions";
import { getContentDetail } from "../../../lib/api";

export default function ContentDetailPage({ params }: { params: { id: string } }) {
  const [detail, setDetail] = useState<ContentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const nextDetail = await getContentDetail(params.id);
        if (!cancelled) setDetail(nextDetail);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "内容加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (loading) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm font-semibold text-slate-500">正在加载内容...</div>;
  }

  if (error || !detail) {
    return <div className="rounded-2xl bg-rose-50 p-5 text-sm font-semibold text-rose-600">{error || "内容不存在"}</div>;
  }

  return (
    <article className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="mb-2 block text-sm font-black tracking-wide text-rose-600">内容详情</span>
          <h1 className="m-0 text-3xl font-black leading-tight tracking-tight text-slate-950">{detail.title}</h1>
          <p className="mt-3 text-sm leading-7 text-slate-500">
            作者 {detail.author.nickname}，内容 ID {params.id}，阅读 {detail.viewCount}，点赞 {detail.likeCount}
          </p>
        </div>
        <ContentDetailActions contentId={params.id} initialLikeCount={detail.likeCount} initialViewCount={detail.viewCount} title={detail.title} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-5 max-lg:grid-cols-1">
        <main className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="grid min-h-64 items-end bg-[linear-gradient(135deg,rgba(244,63,94,0.18),rgba(251,146,60,0.15)),linear-gradient(0deg,rgba(17,24,39,0.08),transparent),#f7fafc] p-6">
            <strong className="max-w-xl text-3xl font-black leading-tight text-slate-950 max-md:text-2xl">{detail.title}</strong>
          </div>
          <div className="p-7 text-base leading-9 text-slate-700">
            {detail.body.split("\n\n").map((paragraph) => (
              <p className="m-0 mb-5 last:mb-0" key={paragraph}>
                {paragraph}
              </p>
            ))}
            <div className="mt-6 flex flex-wrap gap-2">
              {detail.tags.map((tag) => (
                <span className="inline-flex min-h-6 items-center rounded-full bg-slate-100 px-3 py-0.5 text-xs font-black text-slate-600" key={tag}>
                  #{tag}
                </span>
              ))}
            </div>
          </div>
        </main>

        <aside className="grid content-start gap-5">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="m-0 text-xl font-black text-slate-950">分发数据</h2>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Metric label="质量" value={detail.qualityScore} />
              <Metric label="热度" value={detail.heatScore} />
              <Metric label="阅读" value={detail.viewCount} />
              <Metric label="点赞" value={detail.likeCount} />
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="m-0 text-xl font-black text-slate-950">生命周期</h2>
            <div className="mt-4 grid gap-3">
              {["草稿创作", "安全审核", "质量评分", "发布分发", "数据回流"].map((item) => (
                <div className="grid grid-cols-[18px_minmax(0,1fr)] gap-3 text-sm leading-6 text-slate-500" key={item}>
                  <span className="mt-2 size-2.5 rounded-full bg-rose-600" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid gap-2 rounded-lg bg-slate-50 p-4">
      <span className="text-sm font-bold text-slate-500">{label}</span>
      <strong className="text-2xl font-black text-slate-950">{value}</strong>
    </div>
  );
}
