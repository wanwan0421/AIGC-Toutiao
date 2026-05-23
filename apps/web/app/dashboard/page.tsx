import Link from "next/link";
import { ContentStatus } from "@aicp/shared";
import { getContents } from "../../lib/api";
import { Flame, Image, PenTool, Video, Smartphone, type LucideIcon } from "lucide-react";

// 提取精美微型评分条
function ScoreMeter({ value }: { value: number }) {
  const activeCount = Math.max(1, Math.round(value / 10));
  return (
    <div className="flex gap-0.5 w-16" aria-hidden="true" title={`评分: ${value}`}>
      {Array.from({ length: 10 }).map((_, index) => (
        <span
          className={`h-1 flex-1 rounded-full ${index < activeCount ? "bg-emerald-500" : "bg-slate-200"}`}
          key={index}
        />
      ))}
    </div>
  );
}

export default async function DashboardPage() {
  const contents = await getContents();
  const averageScore = contents.length > 0 
    ? contents.reduce((sum, item) => sum + item.qualityScore, 0) / contents.length 
    : 85.5;
  const totalViews = contents.reduce((sum, item) => sum + item.viewCount, 0);
  const totalLikes = contents.reduce((sum, item) => sum + item.likeCount, 0);
  const publishedCount = contents.filter((item) => [ContentStatus.Published, ContentStatus.Updated, ContentStatus.Approved].includes(item.status)).length;
  const topTopics = contents.slice(0, 4).map((item) => ({
    tag: item.title,
    heat: `${item.heatScore} 热度`,
    desc: item.excerpt
  }));

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] min-h-full">
      {/* =================【中轨核心业务流区】================= */}
      <section className="p-6 md:p-8 lg:p-10 border-r border-slate-200/80 pb-24">
        {/* 1. 顶部高端创作者个人信息卡片 */}
        <div className="relative overflow-hidden bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-6 mb-5">
          {/* 左侧身份标识 */}
          <div className="flex items-center gap-4 z-10">
            <div className="w-14 h-14 rounded-full bg-linear-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center font-black text-xl shadow-md shrink-0">
              A
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black text-slate-900 m-0">
                  你好，小李一定行
                </h1>
                <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 border border-blue-100">
                  PRO 创作者
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 font-medium">
                头条号：402983332 | 读研自律中...
              </p>
            </div>
          </div>

          {/* 右侧核心 AI 信用大分外露 */}
          <div className="flex items-center sm:text-right gap-4 sm:gap-0 sm:flex-col justify-between sm:justify-center border-t sm:border-t-0 pt-4 sm:pt-0 border-slate-100 z-10">
            <span className="text-xs font-bold text-slate-400 tracking-wide">
              AI 内容信用分 / 合规均分
            </span>
            <span className="text-3xl font-black text-emerald-500 font-mono tracking-tight mt-0.5">
              {averageScore.toFixed(1)}
            </span>
          </div>

          <div className="absolute right-0 top-0 w-32 h-32 bg-blue-50/30 rounded-full blur-3xl pointer-events-none"></div>
        </div>

        {/* 2. 快捷创作区域 */}
        <div className="mb-5">
          <h2 className="text-xl font-black uppercase tracking-wider mb-3.5 flex items-center gap-2">
            快捷创作
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* 核心高亮：发布文章 */}
            <Link
              href="/editor"
              className="group bg-white p-5 rounded-2xl border border-slate-200 shadow-xs hover:border-blue-500 hover:shadow-md transition-all flex flex-col items-start text-left relative overflow-hidden"
            >
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
                <PenTool className="h-5 w-5" />
              </div>
              <h3 className="font-bold text-slate-800 text-sm">发布文章</h3>
              <p className="text-[11px] text-slate-400 mt-1 leading-normal">
                长文本沉浸式创作画布与 AI 辅助
              </p>
              <div className="absolute right-3 bottom-3 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity text-xs font-bold">
                开始 →
              </div>
            </Link>

            {/* 以下为功能规划与占位 */}
            {[
              {
                title: "发布图文",
                desc: "支持多图片拼接、标签生成",
                icon: Image,
                badge: "规划中",
              },
              {
                title: "视频发布",
                desc: "高清视频格式挂载与切片",
                icon: Video,
                badge: "规划中",
              },
              {
                title: "微头条",
                desc: "短平快想法广场即时发布",
                icon: Smartphone,
                badge: "排期中",
              },
            ].map((box: { title: string; desc: string; icon: LucideIcon; badge: string }, i) => {
              const Icon = box.icon;

              return (
                <div
                  key={i}
                  className="bg-slate-50/60 p-5 rounded-2xl border border-slate-200/50 opacity-65 flex flex-row items-start text-left relative"
                >
                  <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center mb-4">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5">
                      <h3 className="font-bold text-slate-600 text-sm">
                        {box.title}
                      </h3>
                      <span className="text-[9px] font-bold bg-slate-200 text-slate-500 px-1 rounded">
                        {box.badge}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 leading-normal">
                      {box.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 3. 笔记数据总览看板（内嵌多维度核心指标） */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3.5">
            <h2 className="text-xl font-black uppercase tracking-wider flex items-center gap-2">
              笔记数据总览
            </h2>
            <Link
              href="/dashboard/analytics"
              className="text-xs font-bold text-blue-600 hover:underline"
            >
              查看深度数据分析 →
            </Link>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                title: "已发布作品",
                value: publishedCount.toString(),
                sub: `${contents.length} 篇内容进入库`,
                trend: "up",
              },
              {
                title: "总曝光量",
                value: totalViews.toLocaleString(),
                sub: "来自后端内容统计",
                trend: "up",
              },
              {
                title: "作品点赞数",
                value: totalLikes.toLocaleString(),
                sub: "同步数据库最新计数",
                trend: "up",
              },
              {
                title: "内容综合均分",
                value: averageScore.toFixed(1),
                sub: "超越 92% 创作者",
                trend: "up",
                isScore: true,
              },
            ].map((stat, idx) => (
              <div
                key={idx}
                className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs flex flex-col justify-between"
              >
                <div>
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">
                    {stat.title}
                  </span>
                  <div className="text-2xl font-black text-slate-900 font-mono tracking-tight mt-1">
                    {stat.value}
                  </div>
                </div>
                <div className="mt-2.5 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 font-medium">
                    {stat.sub}
                  </span>
                  {stat.isScore ? (
                    <ScoreMeter value={averageScore} />
                  ) : (
                    <span
                      className={`text-[10px] font-black ${stat.trend === "up" ? "text-emerald-600" : "text-rose-500"}`}
                    >
                      {stat.trend === "up" ? "↑" : "↓"}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 4. 双栏功能分流区：左栏创作话题推荐 vs 右栏官方创作技巧 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧：创作话题推荐（2/3 栏宽） */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-3.5">
              <h2 className="text-xl font-black uppercase tracking-wider flex items-center gap-2">
                平台热点与创作话题
              </h2>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs divide-y divide-slate-100 overflow-hidden">
              {topTopics.map((topic, index) => (
                <div
                  key={topic.tag}
                  className="p-4 hover:bg-slate-50/50 cursor-pointer transition flex justify-between items-start gap-4 group"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-blue-600 font-black text-sm">#</span>
                      <h4 className="font-bold text-slate-800 text-sm group-hover:text-blue-600 transition truncate">
                        {index + 1}. {topic.tag}
                      </h4>
                    </div>
                    <p className="text-xs text-slate-400 mt-1 truncate font-medium">
                      {topic.desc}
                    </p>
                  </div>
                  <span className="text-[11px] font-bold text-slate-400 shrink-0 bg-slate-100 px-2 py-0.5 rounded-md">
                    {topic.heat}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 右侧：官方分享技巧卡片 */}
          <div className="lg:col-span-1 flex flex-col">
            <h2 className="text-xl font-black uppercase tracking-wider mb-3.5 flex items-center gap-2">
              成长指南
            </h2>
            <div className="bg-slate-900 rounded-2xl p-5 text-white shadow-xs flex flex-col justify-between flex-1 min-h-55">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                  <h3 className="font-black text-sm text-slate-100">
                    大模型生成规范更新
                  </h3>
                </div>
                <p className="text-slate-400 text-xs leading-relaxed font-medium">
                  平台近期更新算法规则，严厉打击“用纯 AI
                  批量编造无事实依据的假新闻”。创作者在使用火山方舟润色时，请务必前置引入真实背景上下文素材。
                </p>
              </div>

              <Link
                href="/dashboard/growth"
                className="w-full h-9 bg-white/10 hover:bg-white/15 text-white text-xs font-bold rounded-xl flex items-center justify-center transition border border-white/5"
              >
                阅读详细合规指引 →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* =================【右侧常驻：实时爆文榜单挂件】================= */}
      <aside className="bg-white border-l border-slate-200 h-full overflow-y-auto hidden xl:block">
        {/* 粘性置顶头部 */}
        <div className="p-6 sticky top-0 bg-white/90 backdrop-blur-md z-10 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-rose-500" />
            <h2 className="text-sm font-black text-slate-900 m-0 tracking-tight">
              全网实时爆文推荐
            </h2>
          </div>
          <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
            每小时更新
          </span>
        </div>

        {/* 榜单排行流列表 */}
        <div className="p-4 space-y-1">
          {[
            {
              title: "深度解析全栈演进：Cursor 与大模型协同的惊人效率",
              author: "独立开发者生态",
              heat: "99.8w",
            },
            {
              title: "皖南川藏线春季自驾攻略：租车与无人机航拍机位选点",
              author: "特种兵旅游日记",
              heat: "86.5w",
            },
            {
              title: "分布式计算冷思考：异构集群调度中的数据孤岛如何打破",
              author: "地理AI研究社",
              heat: "72.1w",
            },
            {
              title: "小红书爆款图文背后的 3 个黄金 Prompt 骨架公式",
              author: "运营老司机",
              heat: "64.3w",
            },
            {
              title: "Next.js 15 App Router 极致首屏渲染（FCP）调优方案",
              author: "极客前端",
              heat: "51.2w",
            },
            {
              title: "用大模型重构数字孪生系统：我们离通用仿真还有多远",
              author: "数字孪生前沿",
              heat: "44.0w",
            },
          ].map((item, index) => (
            // 点击榜单条目，未来可以通过路由直接导向详细分析页
            <Link
              key={index}
              href={`/dashboard/trends?rank=${index + 1}`}
              className="p-3 rounded-xl hover:bg-slate-50 flex items-start gap-3 transition group"
            >
              {/* 排行名次 */}
              <span
                className={`text-xs font-mono font-black mt-0.5 w-5 shrink-0 ${
                  index === 0
                    ? "text-rose-500 text-sm"
                    : index === 1
                      ? "text-orange-500"
                      : index === 2
                        ? "text-amber-500"
                        : "text-slate-400"
                }`}
              >
                {String(index + 1).padStart(2, "0")}
              </span>

              {/* 作品信息 */}
              <div className="flex-1 min-w-0">
                <h4 className="text-xs font-bold text-slate-800 group-hover:text-blue-600 line-clamp-2 leading-normal mb-1.5 transition">
                  {item.title}
                </h4>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-slate-400 truncate max-w-30">
                    {item.author}
                  </span>
                  <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.2 rounded shrink-0">
                    {item.heat} 热度
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </aside>
    </div>
  );
}