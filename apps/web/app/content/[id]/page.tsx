"use client";

import { useEffect, useState } from "react";
import type { ContentDetail } from "@aicp/shared";
import { RichTextRenderer } from "../../editor/rich-text-editor";
import { ContentDetailActions } from "../../../components/content-detail-actions";
import { StatusBadge } from "../../../components/status-badge";
import { getContentDetail } from "../../../lib/api";

function formatDate(value?: string) {
  if (!value) return "暂未发布";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂未发布";
  return date.toLocaleString("zh-CN", { hour12: false });
}

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
    <article className="mx-auto grid max-w-350 gap-5 px-4 py-5 text-slate-950 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <StatusBadge status={detail.status} />
            <span className="text-xs font-semibold text-slate-400">作者 {detail.author.nickname}</span>
          </div>
          <h1 className="m-0 text-3xl font-black leading-tight tracking-tight text-slate-950">{detail.title}</h1>
          <p className="mt-3 text-sm leading-7 text-slate-500">发布时间：{formatDate(detail.publishedAt)}</p>
        </div>
        <ContentDetailActions contentId={params.id} title={detail.title} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-5 max-lg:grid-cols-1">
        <main className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="relative min-h-72 overflow-hidden bg-slate-100">
            {detail.coverUrl || detail.assets[0]?.url ? (
              <img src={detail.coverUrl ?? detail.assets[0]?.url} alt="" className="h-72 w-full object-cover" />
            ) : (
              <div className="h-72 bg-linear-to-br from-rose-50 via-orange-50 to-slate-100" />
            )}
          </div>
          <div className="p-7 text-base leading-9 text-slate-700">
            {detail.bodyHtml || detail.bodyJson ? (
              <RichTextRenderer
                content={{
                  html: detail.bodyHtml,
                  json: detail.bodyJson,
                  text: detail.body,
                }}
              />
            ) : (
              detail.body.split("\n\n").map((paragraph) => (
                <p className="m-0 mb-5 last:mb-0" key={paragraph}>
                  {paragraph}
                </p>
              ))
            )}
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
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="m-0 text-lg font-black text-slate-950">互动概览</h2>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Metric label="阅读" value={detail.viewCount} />
              <Metric label="点赞" value={detail.likeCount} />
              <Metric label="收藏" value={detail.collectCount ?? 0} />
              <Metric label="热度" value={detail.heatScore} />
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="m-0 text-lg font-black text-slate-950">作者信息</h2>
            <div className="mt-4 flex items-center gap-3">
              {detail.author.avatarUrl ? (
                <img src={detail.author.avatarUrl} alt="" className="h-11 w-11 rounded-full object-cover" />
              ) : (
                <div className="grid h-11 w-11 place-items-center rounded-full bg-rose-600 text-sm font-black text-white">
                  {detail.author.nickname.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-900">{detail.author.nickname}</p>
                <p className="text-xs text-slate-400">持续更新优质图文内容</p>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid gap-2 rounded-xl bg-slate-50 p-4">
      <span className="text-sm font-bold text-slate-500">{label}</span>
      <strong className="text-2xl font-black text-slate-950">{value.toLocaleString()}</strong>
    </div>
  );
}
