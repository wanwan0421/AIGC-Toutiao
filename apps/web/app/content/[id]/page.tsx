import { getContentDetail } from "../../../lib/api";
import { ContentDetailActions } from "../../../components/content-detail-actions";

const scoreRows = [
  ["结构完整度", 92],
  ["表达清晰度", 88],
  ["信息价值", 86],
  ["标题吸引力", 90],
  ["合规性", 96]
] as const;

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

export default async function ContentDetailPage({ params }: { params: { id: string } }) {
  const detail = await getContentDetail(params.id);

  return (
    <article className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="mb-2 block text-sm font-black tracking-wide text-blue-700">内容详情，消费侧视图</span>
          <h1 className="m-0 text-3xl font-black leading-tight tracking-tight text-slate-950">{detail.title}</h1>
          <p className="mt-3 text-sm leading-7 text-slate-500">
            作者 {detail.author.nickname}，内容 ID {params.id}，阅读 {detail.viewCount}，点赞 {detail.likeCount}
          </p>
        </div>
        <ContentDetailActions contentId={params.id} initialLikeCount={detail.likeCount} initialViewCount={detail.viewCount} title={detail.title} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-5 max-lg:grid-cols-1">
        <main className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="grid min-h-64 items-end bg-[linear-gradient(135deg,rgba(25,94,200,0.18),rgba(15,138,98,0.15)),linear-gradient(0deg,rgba(17,24,39,0.08),transparent),#f7fafc] p-6">
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
              {[
                ["质量分", detail.qualityScore],
                ["热度分", detail.heatScore],
                ["阅读", detail.viewCount],
                ["点赞", detail.likeCount]
              ].map(([label, value]) => (
                <div className="grid gap-2 rounded-lg bg-slate-50 p-4" key={label}>
                  <span className="text-sm font-bold text-slate-500">{label}</span>
                  <strong className="text-2xl font-black text-slate-950">{value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="m-0 text-xl font-black text-slate-950">AI 质量拆解</h2>
            <div className="mt-5 grid gap-4">
              {scoreRows.map(([label, score]) => (
                <div className="grid grid-cols-[82px_minmax(0,1fr)_34px] items-center gap-3 text-sm text-slate-500" key={label}>
                  <span>{label}</span>
                  <ScoreMeter value={score} />
                  <strong className="text-right text-slate-950">{score}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="m-0 text-xl font-black text-slate-950">生命周期</h2>
            <div className="mt-4 grid gap-3">
              {[
                "AI 根据 Brief 生成标题、正文和标签。",
                "创作者完成二次编辑并保存版本记录。",
                "安全审核通过，质量评分写入排序池。",
                "读者行为被记录，用于下一轮榜单排序。"
              ].map((item) => (
                <div className="grid grid-cols-[18px_minmax(0,1fr)] gap-3 text-sm leading-6 text-slate-500" key={item}>
                  <span className="mt-2 size-2.5 rounded-full bg-blue-700" />
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
