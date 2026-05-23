import { ContentStatus } from "@aicp/shared";
import { Icons } from "../../components/icons";
import { getContents } from "../../lib/api";

export default async function AnalyticsPage() {
  const contents = await getContents();
  const totalViews = contents.reduce((sum, item) => sum + item.viewCount, 0);
  const totalLikes = contents.reduce((sum, item) => sum + item.likeCount, 0);
  const averageQuality = contents.length > 0
    ? contents.reduce((sum, item) => sum + item.qualityScore, 0) / contents.length
    : 0;
  const publishedCount = contents.filter((item) => [ContentStatus.Published, ContentStatus.Updated, ContentStatus.Approved].includes(item.status)).length;
  const topContents = [...contents]
    .sort((left, right) => right.heatScore - left.heatScore)
    .slice(0, 4);

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto w-full">
      <div className="flex items-center justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-slate-900 m-0">数据中心</h1>
          <p className="text-sm text-slate-500 mt-1">直接从后端内容库汇总作品、曝光和互动数据</p>
        </div>
        <div className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-emerald-700">
          实时后端汇总
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: "累计阅读量", value: totalViews.toLocaleString(), trend: "+来自内容库", isUp: true },
          { label: "账号互动指数", value: averageQuality.toFixed(1), trend: "质量均分", isUp: true },
          { label: "已发布作品", value: publishedCount.toString(), trend: "+数据库同步", isUp: true },
          { label: "总点赞数", value: totalLikes.toLocaleString(), trend: "内容互动回流", isUp: true },
        ].map((stat, i) => (
          <div key={i} className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm">
            <div className="text-sm font-bold text-slate-500 mb-2 flex items-center justify-between">
              {stat.label}
              <Icons.MoreHorizontal className="w-4 h-4 text-slate-300" />
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-black text-slate-900 font-mono">{stat.value}</span>
              <span className="text-xs font-bold px-2 py-0.5 rounded flex items-center gap-0.5 bg-emerald-100/50 text-emerald-600">
                <Icons.TrendingUp className="w-3 h-3" /> {stat.trend}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
            <div>
              <h2 className="text-xl font-black text-slate-950 m-0">热度内容排行</h2>
              <p className="mt-1 text-sm text-slate-500">按后端热度分排序，前四条直接展示在这里</p>
            </div>
            <span className="text-xs font-bold text-slate-400">来源：/api/contents</span>
          </div>

          <div className="grid gap-3">
            {topContents.map((item, index) => (
              <article key={item.id} className="rounded-xl border border-slate-200 p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-3 mb-1.5 flex-wrap">
                    <span className="grid size-8 place-items-center rounded-lg bg-blue-50 text-sm font-black text-blue-700">{index + 1}</span>
                    <span className="text-xs font-bold text-slate-400">{item.status}</span>
                  </div>
                  <h3 className="m-0 text-base font-black text-slate-950 truncate">{item.title}</h3>
                  <p className="m-0 mt-1 text-sm text-slate-500 line-clamp-1">{item.excerpt}</p>
                </div>
                <div className="grid grid-cols-3 gap-3 text-right shrink-0">
                  <div>
                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">质量</div>
                    <div className="text-lg font-black text-slate-950">{item.qualityScore}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">热度</div>
                    <div className="text-lg font-black text-slate-950">{item.heatScore}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">阅读</div>
                    <div className="text-lg font-black text-slate-950">{item.viewCount}</div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="grid content-start gap-5">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="m-0 text-xl font-black text-slate-950">当前结构</h2>
            <div className="mt-4 grid gap-3">
              {[
                `内容总数：${contents.length}`,
                `已发布作品：${publishedCount}`,
                `平均质量分：${averageQuality.toFixed(1)}`,
                `总阅读 / 点赞：${totalViews} / ${totalLikes}`
              ].map((item) => (
                <div className="grid grid-cols-[18px_minmax(0,1fr)] gap-3 text-sm leading-6 text-slate-500" key={item}>
                  <span className="mt-2 size-2.5 rounded-full bg-blue-700" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="m-0 text-xl font-black text-slate-950">行为回流</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              目前前端已经通过后端内容列表、榜单接口和审核接口完成闭环。下一步可以把阅读、点赞和收藏按钮也接到 analytics 事件。
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
