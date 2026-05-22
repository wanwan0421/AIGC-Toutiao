import Link from "next/link";
import { getRankings } from "../../lib/api";

const weights = [
  ["质量分", 45],
  ["阅读热度", 35],
  ["时间衰减", 20]
] as const;

const filterTabs = ["热点", "爆文", "推荐"] as const;

function ScoreMeter({ value }: { value: number }) {
  const activeCount = Math.max(1, Math.round(value / 10));

  return (
    <div className="grid grid-cols-10 gap-1" aria-hidden="true">
      {Array.from({ length: 10 }).map((_, index) => (
        <span
          className={`h-2 rounded-full ${index < activeCount ? "bg-blue-700" : "bg-slate-100"}`}
          key={index}
        />
      ))}
    </div>
  );
}

export default async function RankingsPage() {
  const contents = await getRankings();
  const [topContent, ...rest] = contents;

  return (
    <section className="grid gap-5 max-w-350 mx-auto w-full">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="mb-2 block text-sm font-black tracking-wide text-blue-700">内容消费与智能分发</span>
          <h1 className="m-0 text-3xl font-black leading-tight tracking-tight text-slate-950">热点、爆文与推荐榜单</h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-500">
            发布内容进入候选池后，系统根据质量分、阅读热度和发布时间进行综合排序。读者行为会继续回流，影响下一轮榜单权重。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {filterTabs.map((tab, index) => (
            <button
              className={`rounded-lg px-4 py-2 text-sm font-black transition ${
                index === 0
                  ? "bg-blue-700 text-white hover:bg-blue-800"
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
            <article className="grid grid-cols-[230px_minmax(0,1fr)] gap-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm max-md:grid-cols-1">
              <div className="min-h-44 rounded-lg bg-[linear-gradient(135deg,rgba(25,94,200,0.18),rgba(15,138,98,0.16)),#f4f7fb]" />
              <div className="grid content-between gap-5">
                <div>
                  <span className="inline-flex min-h-6 w-fit items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-black text-emerald-700">
                    当前榜首
                  </span>
                  <h2 className="mt-3 text-2xl font-black leading-snug text-slate-950">
                    <Link href={`/content/${topContent.id}`}>{topContent.title}</Link>
                  </h2>
                  <p className="mt-2 text-sm leading-7 text-slate-500">{topContent.excerpt}</p>
                </div>
                <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
                  {[
                    ["质量分", topContent.qualityScore],
                    ["热度分", topContent.heatScore],
                    ["阅读", topContent.viewCount]
                  ].map(([label, value]) => (
                    <div className="grid gap-2 rounded-lg bg-slate-50 p-4" key={label}>
                      <span className="text-sm font-bold text-slate-500">{label}</span>
                      <strong className="text-2xl font-black text-slate-950">{value}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          ) : null}

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="m-0 text-xl font-black text-slate-950">榜单流</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  列表按综合分返回，前端可继续接入无限滚动和图片懒加载。
                </p>
              </div>
              <span className="text-sm text-slate-500">Redis ZSet 缓存，60 秒刷新</span>
            </div>

            <div className="grid gap-3">
              {rest.map((content, index) => (
                <article
                  className="grid grid-cols-[44px_minmax(0,1fr)_170px] items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 max-md:grid-cols-[36px_minmax(0,1fr)]"
                  key={content.id}
                >
                  <span className="grid size-9 place-items-center rounded-lg bg-blue-50 text-sm font-black text-blue-700">
                    {index + 2}
                  </span>
                  <div>
                    <h3 className="m-0 text-base font-black text-slate-950">
                      <Link href={`/content/${content.id}`}>{content.title}</Link>
                    </h3>
                    <p className="m-0 mt-1 text-sm leading-6 text-slate-500">{content.excerpt}</p>
                  </div>
                  <div className="max-md:col-start-2">
                    <p className="m-0 mb-2 text-sm text-slate-500">
                      质量 {content.qualityScore} / 热度 {content.heatScore}
                    </p>
                    <ScoreMeter value={content.heatScore} />
                  </div>
                </article>
              ))}
            </div>
          </section>
        </main>

        <aside className="grid content-start gap-5">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="m-0 text-xl font-black text-slate-950">排序公式</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              当前 MVP 阶段采用可解释的动态加权方案，后续可接入用户反馈和个性化画像。
            </p>
            <div className="mt-5 grid gap-4">
              {weights.map(([label, value]) => (
                <div className="grid grid-cols-[82px_minmax(0,1fr)_42px] items-center gap-3 text-sm text-slate-500" key={label}>
                  <span>{label}</span>
                  <ScoreMeter value={value * 2} />
                  <strong className="text-right text-slate-950">{value}%</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="m-0 text-xl font-black text-slate-950">性能目标</h2>
            <div className="mt-4 grid gap-3">
              {[
                "首屏只加载榜首和第一屏列表，目标 LCP 不超过 2.5 秒。",
                "图片延迟加载，榜单分页通过 cursor 获取。",
                "阅读、点赞、收藏先写 Redis 计数器，再异步落库。"
              ].map((item) => (
                <div className="grid grid-cols-[18px_minmax(0,1fr)] gap-3 text-sm leading-6 text-slate-500" key={item}>
                  <span className="mt-2 size-2.5 rounded-full bg-blue-700" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="m-0 text-xl font-black text-slate-950">读者行为回流</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              曝光、点击、阅读时长、点赞和收藏会写入 analytics 事件，下一轮排序会把这些信号转化为热度分。
            </p>
          </section>
        </aside>
      </div>
    </section>
  );
}
