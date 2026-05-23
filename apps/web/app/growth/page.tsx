import Link from "next/link";
import { Icons } from "../../components/icons";

export default function GrowthGuidePage() {
  const guides = [
    { title: "2026 前端最新趋势与框架", desc: "采用专业、深度的技术博主口吻，探讨 Next.js 15 和 React 19。", style: "tech-deep", category: "技术分析" },
    { title: "AI 时代的职场转型之路", desc: "结合焦虑缓解与建设性建议，温和表述，提供具体行动指南。", style: "career-coach", category: "职场心理" },
    { title: "全栈工程师到底要求多懂？", desc: "条理清晰，使用大量清单体和真实的工具栈举例。", style: "list-maker", category: "实用干货" }
  ];

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto w-full">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black text-slate-900 m-0">成长指南</h1>
          <p className="text-sm text-slate-500 mt-1">发现热门灵感并快速应用 Prompt 模板进行创作</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {guides.map((guide, i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm flex flex-col hover:shadow-md transition">
            <div className="p-6 flex-1">
              <div className="flex items-center gap-2 mb-4">
                <Icons.Sparkles className="w-4 h-4 text-blue-500" />
                <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-md">
                  {guide.category}
                </span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2.5 leading-snug">{guide.title}</h3>
              <p className="text-sm text-slate-500 line-clamp-3">Prompt 风格：{guide.desc}</p>
            </div>
            
            <div className="p-4 bg-slate-50/50 border-t border-slate-100 mt-auto">
               <Link href={`/editor?promptStyle=${guide.style}&topic=${encodeURIComponent(guide.title)}`} className="w-full flex items-center justify-center gap-2 bg-white border border-slate-200 hover:border-blue-400 hover:text-blue-600 text-slate-700 py-3 rounded-xl text-sm font-bold transition shadow-sm">
                 <Icons.Tool className="w-4 h-4" /> 使用此风格模板创作
               </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
