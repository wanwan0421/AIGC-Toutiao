import Link from "next/link";
import { Hash } from "lucide-react";
import { getOfficialTopics, getRankings } from "../../lib/api";

const filterTabs = ["热门", "新锐", "收藏"] as const;

function compactNumber(value: number) {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return value.toLocaleString();
}

function ScoreMeter({ value }: { value: number }) {
  const activeCount = Math.max(1, Math.round(value / 10));

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

export default async function RankingsPage() {
  const [contents, topics] = await Promise.all([getRankings(), getOfficialTopics(6)]);
  const [topContent, ...rest] = contents;

  return (
    <section className="mx-auto grid w-full max-w-350 gap-5 px-4 py-5 text-slate-950 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="mb-2 block text-sm font-black tracking-wide text-rose-600">全站趋势</span>
          <h1 className="m-0 text-3xl font-black leading-tight tracking-tight text-slate-950">热门榜单</h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-500">
            发现近期表现突出的图文作品，快速捕捉选题方向与内容表达方式。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {filterTabs.map((tab, index) => (
            <button
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                index === 0
                  ? "bg-rose-600 text-white hover:bg-rose-700"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
              key={tab}
              type="button"
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-5 max-lg:grid-cols-1">
        <main className="grid gap-5">
          {topContent ? (
            <article className="grid gap-5 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-[240px_minmax(0,1fr)]">
              <Link href={`/content/${topContent.id}`} className="block min-h-52 overflow-hidden rounded-xl bg-slate-100">
                {topContent.coverUrl ? (
                  <img src={topContent.coverUrl} alt="" className="h-full min-h-52 w-full object-cover" />
                ) : (
                  <div className="h-full min-h-52 bg-linear-to-br from-rose-50 via-orange-50 to-slate-100" />
                )}
              </Link>
              <div className="grid content-between gap-5">
                <div>
                  <span className="inline-flex min-h-6 w-fit items-center rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-black text-rose-600">
                    当前榜首
                  </span>
                  <h2 className="mt-3 text-2xl font-black leading-snug text-slate-950">
                    <Link href={`/content/${topContent.id}`}>{topContent.title}</Link>
                  </h2>
                  <p className="mt-2 text-sm leading-7 text-slate-500">{topContent.excerpt}</p>
                </div>
                <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
                  {[
                    ["热度", topContent.heatScore],
                    ["阅读", topContent.viewCount],
                    ["收藏", topContent.collectCount ?? 0],
                  ].map(([label, value]) => (
                    <div className="grid gap-2 rounded-xl bg-slate-50 p-4" key={label}>
                      <span className="text-sm font-bold text-slate-500">{label}</span>
                      <strong className="text-2xl font-black text-slate-950">{compactNumber(Number(value))}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          ) : null}

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="m-0 text-xl font-black text-slate-950">榜单内容</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  点击作品可查看详情，也可以从作者与话题里寻找新的创作角度。
                </p>
              </div>
            </div>

            <div className="grid gap-3">
              {rest.map((content, index) => (
                <article
                  className="grid grid-cols-[44px_72px_minmax(0,1fr)_160px] items-center gap-4 rounded-xl border border-slate-100 bg-white p-3 transition hover:bg-slate-50 max-md:grid-cols-[36px_64px_minmax(0,1fr)]"
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
                    <p className="m-0 mb-2 text-sm text-slate-500">
                      {compactNumber(content.heatScore)} 热度
                    </p>
                    <ScoreMeter value={content.heatScore} />
                  </div>
                </article>
              ))}
            </div>
          </section>
        </main>

        <aside className="grid content-start gap-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="m-0 text-lg font-black text-slate-950">官方话题</h2>
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
                  </div>
                </Link>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="m-0 text-lg font-black text-slate-950">上榜创作者</h2>
            <div className="mt-4 grid gap-3">
              {contents.slice(0, 5).map((content) => (
                <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3" key={content.id}>
                  <span className="min-w-0 truncate text-sm font-bold text-slate-700">{content.author.nickname}</span>
                  <span className="shrink-0 text-xs font-bold text-rose-600">{compactNumber(content.heatScore)} 热度</span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}
