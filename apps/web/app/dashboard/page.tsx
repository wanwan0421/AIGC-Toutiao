import Link from "next/link";
import { ContentStatus } from "@aicp/shared";
import { StatusBadge } from "../../components/status-badge";
import { getContents } from "../../lib/api";

function ScoreMeter({ value }: { value: number }) {
  const activeCount = Math.max(1, Math.round(value / 10));

  return (
    <div className="flex gap-0.5" aria-hidden="true" title={`评分: ${value}`}>
      {Array.from({ length: 10 }).map((_, index) => (
        <span
          className={`h-1.5 w-full rounded-full ${index < activeCount ? "bg-emerald-500" : "bg-slate-100"}`}
          key={index}
        />
      ))}
    </div>
  );
}

export default async function DashboardPage() {
  const contents = await getContents();
  const publishedCount = contents.filter((item) => item.status === ContentStatus.Published).length;
  const reviewCount = contents.filter((item) => item.status === ContentStatus.PendingReview).length;
  const draftCount = contents.filter((item) => item.status === ContentStatus.Draft).length;
  const averageScore = contents.reduce((sum, item) => sum + item.qualityScore, 0) / Math.max(contents.length, 1);

  return (
    <div className="max-w-350 mx-auto w-full">
      {/* 顶部欢迎区 & 核心数据 */}
      <section className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900 m-0">你好，创作者</h1>
          <p className="text-sm text-slate-500 mt-1">这里是你的内容灵感调度中心。今天想写点什么？</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/editor" className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-blue-700 shadow-sm shadow-blue-600/20">
            <span>➕</span> 新建创作画布
          </Link>
        </div>
      </section>

      {/* 数据概览看板 */}
      <section className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-bold text-slate-500">已发布内容</span>
            <span className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">📝</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900">{publishedCount}</span>
            <span className="text-xs text-slate-400 font-medium">篇</span>
          </div>
        </div>

        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-bold text-slate-500">待审核 / 处理中</span>
            <span className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center text-amber-600">⏳</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900">{reviewCount}</span>
            <span className="text-xs text-slate-400 font-medium">篇</span>
          </div>
        </div>

        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-bold text-slate-500">内容质量均分</span>
            <span className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600">✨</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900">{averageScore.toFixed(1)}</span>
            <span className="text-xs text-emerald-600 font-bold bg-emerald-100/50 px-2 py-0.5 rounded ml-2">+2.4</span>
          </div>
        </div>

        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-bold text-slate-500">近 30 天总阅读</span>
            <span className="w-8 h-8 rounded-full bg-purple-50 flex items-center justify-center text-purple-600">📈</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900">12.4k</span>
            <span className="text-xs text-emerald-600 font-bold bg-emerald-100/50 px-2 py-0.5 rounded ml-2">+14%</span>
          </div>
        </div>
      </section>

      {/* 主体两列布局：左侧稿件列表，右侧系统消息或日历预定 */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        
        {/* 左侧：稿件列表 */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between align-center">
            <h2 className="text-lg font-black text-slate-900 m-0">内容管理库</h2>
            <div className="flex gap-2">
              <select className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-slate-50 text-slate-600 outline-none focus:border-blue-400">
                <option>全部分类</option>
                <option>草稿箱</option>
                <option>已发布</option>
                <option>被打回</option>
              </select>
            </div>
          </div>
          
          <div className="divide-y divide-slate-100">
            {contents.length === 0 ? (
              <div className="p-12 text-center text-slate-400 text-sm">暂无内容，去新建第一篇爆款吧！</div>
            ) : (
              contents.map((content) => {
                const isDraft = content.status === ContentStatus.Draft;
                const isRejected = content.status === ContentStatus.Rejected;
                
                return (
                  <div key={content.id} className="p-6 transition hover:bg-slate-50/50 group flex flex-col sm:flex-row gap-5 items-start sm:items-center">
                    
                    {/* 缩略图占位（假设内容有封面图） */}
                    <div className="w-32 h-20 shrink-0 bg-slate-100 rounded-lg overflow-hidden flex items-center justify-center border border-slate-200/60">
                      <span className="text-2xl opacity-20">🖼️</span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1.5">
                        <StatusBadge status={content.status} />
                        <span className="text-xs font-semibold text-slate-400">ID: {content.id.slice(0, 6)}</span>
                      </div>
                      <h3 className="text-base font-bold text-slate-900 m-0 mb-1 truncate group-hover:text-blue-600 transition-colors">
                        {content.title || "未命名草稿"}
                      </h3>
                      <p className="text-sm text-slate-500 m-0 line-clamp-1">
                        {content.excerpt || "暂无内容摘要..."}
                      </p>
                    </div>

                    <div className="w-32 shrink-0 max-md:hidden flex flex-col gap-1.5">
                      <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">AI 质量评分</div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black text-slate-700">{content.qualityScore}</span>
                        <div className="flex-1"><ScoreMeter value={content.qualityScore} /></div>
                      </div>
                    </div>

                    <div className="w-24 shrink-0 hidden lg:block text-right">
                      <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">阅读热度</div>
                      <span className="text-sm font-black text-slate-700">{content.heatScore || 0}</span>
                    </div>

                    <div className="shrink-0 max-sm:w-full flex justify-end">
                      <Link
                        className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-bold transition whitespace-nowrap 
                          ${isRejected 
                            ? "bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200" 
                            : isDraft 
                              ? "bg-slate-100 text-slate-700 hover:bg-slate-200" 
                              : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                          }
                        `}
                        href={content.status === ContentStatus.Published ? `/content/${content.id}` : "/editor"}
                      >
                        {isRejected ? "执行合规改写" : isDraft ? "继续编辑" : "查看数据"}
                      </Link>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          
          <div className="p-4 border-t border-slate-100 bg-slate-50 text-center">
            <button className="text-sm font-bold text-slate-500 hover:text-slate-800 transition">加载更多</button>
          </div>
        </section>

        {/* 右侧：辅助功能卡片 */}
        <aside className="flex flex-col gap-6">
          <div className="bg-linear-to-br from-blue-600 to-indigo-700 rounded-xl p-6 shadow-md text-white">
            <h3 className="font-black text-lg mb-2">CreatorFlow Pro</h3>
            <p className="text-blue-100 text-sm leading-relaxed mb-4">
              升级专业版，解锁超长文上下文记忆，并可无限次调用爆款标题探测器。
            </p>
            <button className="w-full py-2.5 bg-white text-blue-700 font-black rounded-lg text-sm hover:bg-blue-50 transition shadow-sm">
              了解特权
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h3 className="font-black text-slate-900 m-0 mb-4 text-base">系统通知与建议</h3>
            <div className="space-y-4">
              <div className="flex gap-3">
                <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0 mt-1.5"></span>
                <div>
                  <p className="text-sm font-bold text-slate-800 mb-0.5">合规策略更新</p>
                  <p className="text-xs text-slate-500 leading-relaxed">平台最新禁设“夸大焦虑”相关的标题词汇集，请前往偏好设置更新。</p>
                </div>
              </div>
              <div className="flex gap-3">
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 mt-1.5"></span>
                <div>
                  <p className="text-sm font-bold text-slate-800 mb-0.5">你的文章上榜了！</p>
                  <p className="text-xs text-slate-500 leading-relaxed">《夏日通勤穿搭...》已被推进本地热点流，曝光提升 300%。</p>
                </div>
              </div>
              <div className="flex gap-3">
                <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-1.5"></span>
                <div>
                  <p className="text-sm font-bold text-slate-800 mb-0.5">AI 模型升级到 v2.0</p>
                  <p className="text-xs text-slate-500 leading-relaxed">生成长文的响应速度极大提升，降低了润色丢失排版的概率。</p>
                </div>
              </div>
            </div>
          </div>
        </aside>

      </div>
    </div>
  );
}
