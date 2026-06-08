import Link from "next/link";
import { Hash, PenTool, TrendingUp } from "lucide-react";
import { getTopicDetail } from "../../../lib/api";

function compactNumber(value: number) {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return value.toLocaleString();
}

export default async function TopicDetailPage({ params }: { params: { title: string } }) {
  const title = decodeURIComponent(params.title);
  const { topic, items } = await getTopicDetail(title, 30);

  return (
    <div className="min-h-full bg-[#f7f8fb] p-6">
      <section className="overflow-hidden rounded-[32px] bg-white shadow-sm">
        <div className="relative min-h-64 p-8">
          {topic.coverUrl ? (
            <img src={topic.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-[#fff3f5] via-white to-slate-100" />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-white via-white/90 to-white/20" />
          <div className="relative max-w-3xl">
            <span className="inline-flex items-center gap-2 rounded-full bg-[#fff3f5] px-4 py-2 text-sm font-bold text-[#ff2442]">
              <Hash size={16} />
              热点
            </span>
            <h1 className="mt-5 text-4xl font-black text-slate-950">#{topic.title}</h1>
            <p className="mt-4 max-w-2xl text-base leading-8 text-slate-600">{topic.description}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <span className="rounded-2xl bg-white/80 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm">
                {compactNumber(topic.heatScore)} 热度
              </span>
              <span className="rounded-2xl bg-white/80 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm">
                {topic.contentCount} 篇相关内容
              </span>
              <Link href={`/editor?topic=${encodeURIComponent(topic.title)}`} className="inline-flex items-center gap-2 rounded-2xl bg-[#ff2442] px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-[#e91635]">
                <PenTool size={16} />
                参与创作
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-[32px] bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-950">相关作品</h2>
            <p className="mt-1 text-sm text-slate-400">围绕当前热点的创作内容</p>
          </div>
          <TrendingUp className="text-[#ff2442]" size={22} />
        </div>

        {items.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <Link key={item.id} href={`/content/${item.id}`} className="group overflow-hidden rounded-3xl border border-slate-100 bg-white transition hover:-translate-y-0.5 hover:shadow-lg">
                {item.coverUrl ? (
                  <img src={item.coverUrl} alt="" className="h-40 w-full object-cover" />
                ) : (
                  <div className="grid h-40 place-items-center bg-slate-50 text-[#ff2442]">
                    <Hash size={28} />
                  </div>
                )}
                <div className="p-4">
                  <h3 className="line-clamp-2 text-base font-black text-slate-950 group-hover:text-[#ff2442]">{item.title}</h3>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">{item.excerpt}</p>
                  <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
                    <span>{item.author.nickname}</span>
                    <span>{compactNumber(item.heatScore)} 热度</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-3xl bg-slate-50 p-10 text-center">
            <Hash className="mx-auto text-[#ff2442]" size={28} />
            <p className="mt-3 text-sm font-semibold text-slate-700">当前热点还没有相关作品</p>
            <Link href={`/editor?topic=${encodeURIComponent(topic.title)}`} className="mt-5 inline-flex rounded-2xl bg-[#ff2442] px-5 py-2 text-sm font-bold text-white">
              发布第一篇
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
