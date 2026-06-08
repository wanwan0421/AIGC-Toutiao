"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bookmark, Eye, Flame, Hash, Loader2, Sparkles, TrendingUp } from "lucide-react";
import type { ContentSummary, OfficialTopicSummary, RankingQuery } from "@aicp/shared";
import { getOfficialTopics, getRankings } from "../../lib/api";

const rankingTabs: Array<{ type: RankingQuery["type"]; label: string; description: string }> = [
  { type: "viral", label: "综合爆文", description: "热度、互动、阅读、质量综合排序" },
  { type: "hot", label: "阅读热度", description: "优先展示近期阅读和热度高的作品" },
  { type: "recommended", label: "质量优先", description: "优先展示质量分和内容完成度" },
];

function compactNumber(value: number) {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return value.toLocaleString();
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]) {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !seen.has(item.id))];
}

function ScoreMeter({ value }: { value: number }) {
  const activeCount = Math.max(1, Math.min(10, Math.round(value / 10)));
  return (
    <div className="grid grid-cols-10 gap-1" aria-hidden="true">
      {Array.from({ length: 10 }).map((_, index) => (
        <span
          className={`h-2 rounded-full ${index < activeCount ? "bg-rose-500" : "bg-slate-100"}`}
          key={index}
        />
      ))}
    </div>
  );
}

export default function RankingsPage() {
  const [rankingType, setRankingType] = useState<RankingQuery["type"]>("viral");
  const [contents, setContents] = useState<ContentSummary[]>([]);
  const [contentCursor, setContentCursor] = useState<string | undefined>();
  const [contentDone, setContentDone] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [topics, setTopics] = useState<OfficialTopicSummary[]>([]);
  const [topicCursor, setTopicCursor] = useState<string | undefined>();
  const [topicDone, setTopicDone] = useState(false);
  const [topicLoading, setTopicLoading] = useState(false);
  const [message, setMessage] = useState("");
  const contentSentinelRef = useRef<HTMLDivElement | null>(null);
  const topicSentinelRef = useRef<HTMLDivElement | null>(null);
  const contentLoadingRef = useRef(false);
  const topicLoadingRef = useRef(false);
  const contentRequestSeqRef = useRef(0);
  const topicRequestSeqRef = useRef(0);

  async function loadContents(reset = false) {
    if (contentLoadingRef.current && !reset) return;
    const requestSeq = contentRequestSeqRef.current + 1;
    contentRequestSeqRef.current = requestSeq;
    contentLoadingRef.current = true;
    setContentLoading(true);
    setMessage("");
    try {
      const response = await getRankings({
        type: rankingType,
        limit: 12,
        cursor: reset ? undefined : contentCursor,
      });
      if (contentRequestSeqRef.current === requestSeq) {
        setContents((items) => (reset ? response.items : mergeById(items, response.items)));
        setContentCursor(response.nextCursor);
        setContentDone(!response.nextCursor);
      }
    } catch (error) {
      if (contentRequestSeqRef.current === requestSeq) {
        setMessage(error instanceof Error ? `榜单加载失败：${error.message}` : "榜单加载失败");
      }
    } finally {
      if (contentRequestSeqRef.current === requestSeq) {
        contentLoadingRef.current = false;
        setContentLoading(false);
      }
    }
  }

  async function loadTopics(reset = false) {
    if (topicLoadingRef.current && !reset) return;
    const requestSeq = topicRequestSeqRef.current + 1;
    topicRequestSeqRef.current = requestSeq;
    topicLoadingRef.current = true;
    setTopicLoading(true);
    try {
      const response = await getOfficialTopics({
        limit: 8,
        cursor: reset ? undefined : topicCursor,
      });
      if (topicRequestSeqRef.current === requestSeq) {
        setTopics((items) => (reset ? response.items : mergeById(items, response.items)));
        setTopicCursor(response.nextCursor);
        setTopicDone(!response.nextCursor);
      }
    } finally {
      if (topicRequestSeqRef.current === requestSeq) {
        topicLoadingRef.current = false;
        setTopicLoading(false);
      }
    }
  }

  useEffect(() => {
    setContents([]);
    setContentCursor(undefined);
    setContentDone(false);
    void loadContents(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankingType]);

  useEffect(() => {
    void loadTopics(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const target = contentSentinelRef.current;
    if (!target || contentDone) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadContents(false);
    }, { rootMargin: "200px" });
    observer.observe(target);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentCursor, contentDone, contentLoading, rankingType]);

  useEffect(() => {
    const target = topicSentinelRef.current;
    if (!target || topicDone) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadTopics(false);
    }, { rootMargin: "200px" });
    observer.observe(target);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicCursor, topicDone, topicLoading]);

  const [topContent, ...restContents] = contents;
  const activeTab = rankingTabs.find((tab) => tab.type === rankingType) ?? rankingTabs[0];

  return (
    <section className="mx-auto grid w-full max-w-350 gap-5 px-4 py-5 text-slate-950 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="m-0 text-3xl font-black leading-tight tracking-tight text-slate-950">热点与爆文</h1>
        <div className="flex flex-wrap gap-2">
          {rankingTabs.map((tab) => (
            <button
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                rankingType === tab.type
                  ? "bg-rose-600 text-white hover:bg-rose-700"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
              key={tab.type}
              onClick={() => setRankingType(tab.type)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {message ? <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">{message}</div> : null}

      <div className="grid items-start grid-cols-[minmax(0,1fr)_340px] gap-5 max-lg:grid-cols-1">
        <main className="grid min-w-0 content-start gap-5">
          {topContent ? (
            <article className="grid items-start gap-5 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-[240px_minmax(0,1fr)]">
              <Link href={`/content/${topContent.id}`} className="block h-52 overflow-hidden rounded-xl bg-slate-100 md:h-60">
                {topContent.coverUrl ? (
                  <img src={topContent.coverUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full bg-linear-to-br from-rose-50 via-orange-50 to-slate-100" />
                )}
              </Link>
              <div className="grid content-between gap-5">
                <div>
                  <span className="inline-flex min-h-6 w-fit items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-black text-rose-600">
                    <Flame size={14} />
                    当前榜首
                  </span>
                  <h2 className="mt-3 text-2xl font-black leading-snug text-slate-950">
                    <Link href={`/content/${topContent.id}`}>{topContent.title}</Link>
                  </h2>
                  <p className="mt-2 text-sm leading-7 text-slate-500">{topContent.excerpt}</p>
                </div>
                <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
                  <Metric label="热度" value={topContent.heatScore} />
                  <Metric label="阅读" value={topContent.viewCount} />
                  <Metric label="质量" value={topContent.qualityScore} />
                </div>
              </div>
            </article>
          ) : null}

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
              <h2 className="m-0 text-xl font-black text-slate-950">爆文榜</h2>
              <TrendingUp className="text-rose-600" size={22} />
            </div>

            <div className="grid gap-3">
              {restContents.map((content, index) => (
                <article
                  className="grid grid-cols-[44px_72px_minmax(0,1fr)_170px] items-center gap-4 rounded-xl border border-slate-100 bg-white p-3 transition hover:bg-slate-50 max-md:grid-cols-[36px_64px_minmax(0,1fr)]"
                  key={content.id}
                >
                  <span className="grid size-9 place-items-center rounded-lg bg-rose-50 text-sm font-black text-rose-600">
                    {index + 2}
                  </span>
                  <Link href={`/content/${content.id}`} className="block h-16 overflow-hidden rounded-xl bg-slate-100">
                    {content.coverUrl ? (
                      <img src={content.coverUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full bg-linear-to-br from-rose-50 to-orange-50" />
                    )}
                  </Link>
                  <div className="min-w-0">
                    <h3 className="m-0 truncate text-base font-black text-slate-950">
                      <Link href={`/content/${content.id}`}>{content.title}</Link>
                    </h3>
                    <p className="m-0 mt-1 line-clamp-1 text-sm leading-6 text-slate-500">{content.excerpt}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-400">{content.author.nickname}</p>
                  </div>
                  <div className="max-md:col-start-3">
                    <p className="m-0 mb-2 text-sm text-slate-500">{compactNumber(content.heatScore)} 热度</p>
                    <ScoreMeter value={content.heatScore} />
                  </div>
                </article>
              ))}
            </div>

            <div ref={contentSentinelRef} className="mt-5 grid min-h-10 place-items-center text-sm font-semibold text-slate-400">
              {contentLoading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="animate-spin" size={16} />
                  正在加载更多爆文
                </span>
              ) : contentDone ? (
                "已加载全部爆文"
              ) : (
                "继续向下滚动加载"
              )}
            </div>
          </section>
        </main>

        <aside className="grid min-w-0 content-start gap-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="m-0 text-lg font-black text-slate-950">热点</h2>
              <Hash className="text-rose-600" size={22} />
            </div>
            <div className="mt-4 grid gap-3">
              {topics.map((topic) => (
                <Link
                  href={`/topics/${encodeURIComponent(topic.title)}`}
                  key={topic.id}
                  className="flex gap-3 rounded-xl bg-slate-50 p-3 transition hover:bg-rose-50"
                >
                  {topic.coverUrl ? (
                    <img src={topic.coverUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-600">
                      <Hash className="h-5 w-5" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-black text-slate-900">#{topic.title}</h3>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-500">{topic.description}</p>
                    <p className="mt-2 text-xs font-bold text-rose-600">
                      {topic.contentCount} 篇 · {compactNumber(topic.heatScore)} 热度
                    </p>
                  </div>
                </Link>
              ))}
            </div>
            <div ref={topicSentinelRef} className="mt-4 grid min-h-10 place-items-center text-xs font-semibold text-slate-400">
              {topicLoading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="animate-spin" size={14} />
                  加载热点
                </span>
              ) : topicDone ? (
                "热点已全部加载"
              ) : (
                "滚动加载更多热点"
              )}
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid gap-2 rounded-xl bg-slate-50 p-4">
      <span className="text-sm font-bold text-slate-500">{label}</span>
      <strong className="text-2xl font-black text-slate-950">{compactNumber(value)}</strong>
    </div>
  );
}

function Signal({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
      <span className="text-rose-600">{icon}</span>
      <span>{label}</span>
    </div>
  );
}
