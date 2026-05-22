"use client";

import { useMemo, useState } from "react";

const titleCandidates = [
  "通勤穿搭不用想太多：5 个公式清爽出门",
  "夏天上班穿什么？这 5 套公式直接照搬",
  "衣柜不够多，也能穿出清爽通勤感",
  "20-30 岁女生的夏日通勤穿搭模板",
  "一周通勤不重样，靠这 5 个轻量公式"
];

const slashActions = ["续写", "润色", "改变语气", "插入配图建议"];
const selectionActions = ["润色", "扩写", "改变风格", "续写"];

const directDraft = `夏天通勤最怕两件事：出门路上闷热，进办公室又被空调吹冷。与其每天重新搭配，不如准备一套可以复用的穿搭公式。

第一，选择透气但有型的上衣。棉麻、轻薄衬衫和有垂感的针织都适合通勤，不会显得太随意，也能保持清爽。

第二，用低饱和色做主色。白色、浅灰、雾蓝、燕麦色更容易互相搭配，拍成图文时也更干净。

第三，给空调房准备一件轻薄外套。防晒衬衫、薄针织或短款小外套都可以，让通勤造型更完整。

第四，鞋包尽量轻量。通勤不是走秀，舒适和容量会直接影响一整天的状态。

第五，每套搭配保留一个亮点。可以是耳饰、丝巾、包包颜色或腰线处理，让封面图更容易被读者注意到。`;

const initialBody = `如果你每天早上都在衣柜前犹豫，可以先从“可复用公式”开始搭配。

1. 选择透气但有型的上衣，避免通勤路上闷热。
2. 用低饱和色做主色，搭配更稳定，也更适合图片呈现。
3. 准备一件轻薄外套，应对办公室空调.
4. 鞋包尽量轻量，降低全天通勤负担。
5. 每套搭配保留一个亮点，让封面图更容易被点击。`;

const inputClass =
  "mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400";

export default function EditorPage() {
  // 1. 左侧：前置全局策略状态（由 AI 在后台提取后反显，或由创作者微调）
  const [isLeftExpanded, setIsLeftExpanded] = useState(false);
  const [leftTab, setLeftTab] = useState<"requirements" | "assets">("requirements");
  const [globalTheme, setGlobalTheme] = useState("");
  const [globalAudience, setGlobalAudience] = useState("");
  const [globalStyle, setGlobalStyle] = useState("");
  const [globalPoints, setGlobalPoints] = useState("");
  const [globalKeywords, setGlobalKeywords] = useState("");

  // 2. 中间：编辑器状态
  const [title, setTitle] = useState("夏日通勤穿搭的 5 个轻量公式");
  const [body, setBody] = useState(initialBody);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [showSelectionMenu, setShowSelectionMenu] = useState(false);
  const [showTitlePanel, setShowTitlePanel] = useState(false);
  const [status, setStatus] = useState("✅ 草稿已自动保存");

  // 3. 右侧：AI 交互中心状态
  const [rightTab, setRightTab] = useState<"brainstorm" | "generate">("brainstorm");
  const [chatInputValue, setChatInputValue] = useState("");
  const [generateInputValue, setGenerateInputValue] = useState("");
  const [chatMessages, setChatMessages] = useState([
    { role: "ai", text: "💡 我是你的全能副驾。你可以在这里跟我【碰撞思路】，或者切换到【直接生成】一键输出结构化图文。" },
    { role: "user", text: "我想写一篇夏日通勤穿搭，你觉得从什么角度切入比较新颖？" },
    { role: "ai", text: "建议从“轻量公式”切入。你可以分享 5 个可以直接套用的公式，比如“防晒衣+吊带+阔腿裤”，这样读者实操性强。满意的话，可以直接点击下方的快捷成稿。" }
  ]);

  const wordCount = useMemo(() => body.replace(/\s/g, "").length, [body]);

  // 全局唯一核心发动机：右侧调度大权
  function handleSuperGenerate() {
    setStatus("⚡ AI 正在深度构思并排版中...");
    
    // 模拟后端 Workflow 返回的结构化 JSON
    setTimeout(() => {
      // 流向 1：注入中央主编辑器
      setTitle("通勤穿搭不用想太多：5 个公式清爽出门");
      setBody(directDraft);

      // 流向 2：自动提取特征，反显并填充到左侧前置全局参数
      setGlobalTheme("夏日通勤穿搭");
      setGlobalAudience("20-30 岁通勤女性");
      setGlobalStyle("短图文种草、清爽、实用");

      // 流向 3：联动展开左侧，向用户视觉提示：“AI 已经为你打好了前置地基”
      setIsLeftExpanded(true);
      setStatus("🚀 AI 已一次性生成完整图文，并在左侧反显全局策略标签");
    }, 600);
  }

  // 快捷桥接：把聊天里碰撞好的灵感一键送去生成
  function bridgeChatToGeneration() {
    setGenerateInputValue("就按刚才讨论的“轻量公式”，写一篇 20-30 岁女性的夏日通勤穿搭。");
    setRightTab("generate");
  }

  function updateBody(value: string) {
    setBody(value);
    setShowSlashMenu(value.endsWith("/"));
    setStatus("📝 正在编辑，30 秒后自动保存");
  }

  function applySlashAction(action: string) {
    setShowSlashMenu(false);
    if (action === "续写") {
      setBody((current) => `${current.replace(/\/$/, "")}\n\nAI 续写建议：可以在结尾补充一份“明日通勤快速选择清单”，帮助读者直接行动。`);
      return;
    }
    if (action === "插入配图建议") {
      setBody((current) => `${current.replace(/\/$/, "")}\n\n配图建议：此处适合插入一张浅色背景的夏日通勤街拍图，突出轻薄外套和低饱和配色。`);
      return;
    }
    setBody((current) => current.replace(/\/$/, ""));
    setStatus(`已执行 AI 动作：${action}`);
  }

  function handleSendChatMessage() {
    if (!chatInputValue.trim()) return;
    setChatMessages((prev) => [...prev, { role: "user", text: chatInputValue }]);
    setChatInputValue("");
    // 模拟 AI 实时回复
    setTimeout(() => {
      setChatMessages((prev) => [...prev, { role: "ai", text: "收到你的新想法！这个角度很棒，建议可以在大纲中专门留出一节来体现这个思路。" }]);
    }, 400);
  }

  return (
    <section className="flex flex-col max-w-350 mx-auto w-full px-6 lg:px-10 py-6 bg-slate-50 font-sans">
      {/* 头部布局 */}
      <header className="flex items-end justify-between gap-6 mb-6 pb-4 border-b border-slate-200 shrink-0">
        <div>
          <span className="mb-2 block text-sm font-extrabold tracking-widest uppercase text-blue-600">CreatorFlow Studio</span>
          <h1 className="m-0 text-[26px] font-black tracking-tight text-slate-900">让 AI 理解上下文，创作者掌控最终表达。</h1>
          <p className="mt-1 text-sm text-slate-500">以画布编辑为主体，左侧沉淀资产与反显配置，右侧统筹输入与思路碰撞。</p>
        </div>
        <div className="flex gap-3">
          <button className="rounded-lg border border-slate-200 bg-white px-6 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors" type="button">保存草稿</button>
          <button className="rounded-lg border border-slate-200 bg-white px-6 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors" type="button">预览</button>
          <button className="rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors" type="button">提交审核</button>
        </div>
      </header>

      {/* 主体工作台 */}
      <div className="flex gap-5 flex-1 min-h-0">
        
        {/* 1. 左侧：创作前置准备区（去除主动生成按钮，降级为资产/配置面板） */}
        <aside className={`flex flex-col shrink-0 bg-white border border-slate-200 rounded-xl overflow-hidden transition-all duration-300 ease-in-out shadow-sm ${isLeftExpanded ? "w-80" : "w-14 items-center"}`}>
          {!isLeftExpanded ? (
            <div className="flex-1 flex items-center justify-center cursor-pointer bg-slate-50 w-full hover:bg-slate-100 transition-colors" onClick={() => setIsLeftExpanded(true)}>
              <div className="text-slate-400 font-bold tracking-[0.2em] [writing-mode:vertical-rl] text-xs flex items-center gap-1">
                <span>◀</span> 展开配置与素材库
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-full p-5 min-h-0">
              <div className="flex justify-between items-center mb-4 shrink-0">
                <div>
                  <h2 className="text-sm font-bold text-slate-900 m-0">策略与素材资产</h2>
                  <p className="text-[11px] text-slate-400 mt-0.5">控制全局硬性约束条件</p>
                </div>
                <button onClick={() => setIsLeftExpanded(false)} className="text-slate-400 hover:text-slate-600 text-xs">收起 ◀</button>
              </div>
              
              <div className="flex gap-2 p-1 bg-slate-100 rounded-lg mb-4 shrink-0">
                <button onClick={() => setLeftTab("requirements")} className={`flex-1 py-1 text-xs rounded-md font-medium transition-all ${leftTab === "requirements" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                  基础需求
                </button>
                <button onClick={() => setLeftTab("assets")} className={`flex-1 py-1 text-xs rounded-md font-medium transition-all ${leftTab === "assets" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                  素材管理
                </button>
              </div>

              <div className="flex-1 overflow-y-auto pr-1 space-y-3.5 text-xs">
                {leftTab === "requirements" ? (
                  <>
                    <div>
                      <span className="font-semibold text-slate-500 block mb-1">主题 (AI 生成后自动提炼)</span>
                      <input type="text" value={globalTheme} onChange={(e) => setGlobalTheme(e.target.value)} placeholder="暂无，由右侧一键生成后自动反显" className={inputClass} />
                    </div>
                    <div>
                      <span className="font-semibold text-slate-500 block mb-1">目标人群</span>
                      <input type="text" value={globalAudience} onChange={(e) => setGlobalAudience(e.target.value)} placeholder="例如：20-30岁职场人" className={inputClass} />
                    </div>
                    <div>
                      <span className="font-semibold text-slate-500 block mb-1">内容风格约束</span>
                      <input type="text" value={globalStyle} onChange={(e) => setGlobalStyle(e.target.value)} placeholder="例如：种草风、幽默" className={inputClass} />
                    </div>
                    <div>
                      <span className="font-semibold text-slate-500 block mb-1">核心观点</span>
                      <textarea value={globalPoints} onChange={(e) => setGlobalPoints(e.target.value)} placeholder="列出你想强调的几个核心点..." className={`${inputClass} min-h-20 resize-none`} />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="border-2 border-dashed border-slate-200 bg-slate-50 rounded-lg p-6 text-center cursor-pointer hover:border-slate-300 transition-colors">
                      <span className="text-2xl text-slate-400">+</span>
                      <p className="mt-1 text-xs text-slate-400">拖拽上传图片/视频资产</p>
                    </div>
                    <div>
                      <span className="font-semibold text-slate-500 block mb-1">背景参考资料 (AI 将自动引用)</span>
                      <textarea placeholder="在这里粘贴你找好的爆款大纲或行业硬核数据..." className={`${inputClass} min-h-20 resize-none`} />
                    </div>
                    <div>
                      <span className="font-semibold text-slate-500 block mb-1">关键词</span>
                      <input type="text" value={globalKeywords} onChange={(e) => setGlobalKeywords(e.target.value)} placeholder="输入SEO或标签关键词，逗号分隔" className={inputClass} />
                    </div>
                  </>
                )}
              </div>
              <div className="pt-4 mt-3 border-t border-slate-100 flex flex-col gap-2 shrink-0">
                <button 
                  onClick={handleSuperGenerate}
                  className="w-full py-2.5 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-sm shadow-blue-500/20 transition-all flex justify-center items-center gap-1.5"
                >
                  <span className="text-sm">✨</span> AI 一键生成初稿
                </button>
              </div>
            </div>
          )}
        </aside>

        {/* 2. 中间：人工编辑画布 */}
        <main className="flex-1 flex flex-col bg-white border border-slate-200 rounded-xl px-8 lg:px-12 py-7 shadow-sm overflow-hidden min-w-0">
          <div className="flex justify-between items-start max-w-6xl w-full mx-auto mb-6 shrink-0">
            <div>
              <h2 className="text-xl font-bold text-slate-900 m-0">中央主编辑区</h2>
              <p className="text-xs text-slate-400 mt-1">这里是属于你的终稿画布。使用 <kbd className="px-1 py-0.5 rounded border border-slate-200 bg-slate-50 text-slate-600 font-mono text-[11px] mx-0.5">/</kbd> 触发伴随指令，或直接用鼠标划词。</p>
            </div>
            <span className={`px-3 py-1.5 rounded-md text-xs font-medium border ${status.includes("⚡") ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>
              {status}
            </span>
          </div>

          <div className="flex-1 flex flex-col relative max-w-6xl w-full mx-auto pb-6">
            {/* 标题与爆款魔法棒 */}
            <div className="flex items-center pb-3 mb-4 border-b border-slate-100 relative shrink-0">
              <input className="flex-1 text-2xl font-bold bg-transparent border-0 outline-none text-slate-900 placeholder:text-slate-200" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="未命名标题" />
              <button onClick={() => setShowTitlePanel(!showTitlePanel)} className="ml-3 p-1.5 rounded-lg bg-slate-50 border border-slate-200 text-sm hover:bg-slate-100 transition-colors" title="AI 智能衍生更多标题">
                🪄 换个爆款标题
              </button>
              {showTitlePanel && (
                <div className="absolute top-[110%] right-0 bg-white border border-slate-200 rounded-xl p-4 z-20 w-80 shadow-xl animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex justify-between items-center mb-2.5">
                    <h4 className="text-xs font-bold text-slate-500 m-0">AI 针对本文推荐的衍生标题</h4>
                    <button className="text-slate-400 text-base" onClick={() => setShowTitlePanel(false)}>×</button>
                  </div>
                  <ul className="m-0 p-0 list-none space-y-1.5">
                    {titleCandidates.map((candidate, i) => (
                      <li key={i} className="cursor-pointer text-xs text-blue-700 p-2.5 rounded-lg bg-blue-50/50 border border-transparent hover:border-blue-200 transition-colors" onClick={() => { setTitle(candidate); setShowTitlePanel(false); }}>
                        {candidate}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* 正文文本区域 */}
            <div className="relative flex-1">
              <textarea className="w-full h-full text-sm leading-relaxed text-slate-700 bg-transparent border-0 outline-none resize-none font-normal" value={body} onChange={(event) => updateBody(event.target.value)} onSelect={(event) => setShowSelectionMenu(event.currentTarget.selectionStart !== event.currentTarget.selectionEnd)} placeholder="直接动手写下你的第一个灵感碎片，或者使用右侧 AI 一键输出初稿..." />
              
              {showSlashMenu && (
                <div className="absolute left-4 top-12 z-20 bg-white border border-slate-200 w-48 p-1.5 rounded-xl shadow-xl flex flex-col">
                  <strong className="text-[10px] text-slate-400 px-2.5 py-1.5">AI 随身挂件</strong>
                  {slashActions.map((action) => (
                    <button className="text-left px-2.5 py-1.5 text-xs text-slate-700 rounded-lg hover:bg-blue-50 hover:text-blue-700 transition-colors" type="button" key={action} onClick={() => applySlashAction(action)}>
                      {action}
                    </button>
                  ))}
                </div>
              )}

              {showSelectionMenu && (
                <div className="absolute top-1/4 left-1/4 bg-slate-900 text-white p-1 rounded-lg flex shadow-xl z-20 gap-0.5">
                  {selectionActions.map((action) => (
                    <button className="px-2.5 py-1.5 text-xs font-medium rounded hover:bg-slate-800 transition-colors" type="button" key={action} onClick={() => { setStatus(`已对选中文字执行 AI ${action}`); setShowSelectionMenu(false); }}>
                      {action}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="absolute bottom-0 right-0 text-slate-400 text-xs font-medium">{wordCount} 字</div>
          </div>
        </main>

        {/* 3. 右侧：全站唯一发动机交互中心 */}
        <aside className="w-90 shrink-0 flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
           {/* 双轨切换模式 */}
           <div className="flex border-b border-slate-200 bg-slate-50 shrink-0">
             <button onClick={() => setRightTab("brainstorm")} className={`flex-1 py-3.5 text-xs transition-all border-b-2 ${rightTab === "brainstorm" ? "bg-white font-black border-blue-500 text-blue-600" : "border-transparent text-slate-400 hover:text-slate-600"}`}>
               💬 碰撞思路 (聊天轨)
             </button>
             <button onClick={() => setRightTab("generate")} className={`flex-1 py-3.5 text-xs transition-all border-b-2 ${rightTab === "generate" ? "bg-white font-black border-emerald-500 text-emerald-600" : "border-transparent text-slate-400 hover:text-slate-600"}`}>
               🚀 直接生成 (生产轨)
             </button>
           </div>

           {/* 主动交互视图 */}
           <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 bg-slate-50/50 min-h-0">
             {rightTab === "brainstorm" ? (
               <>
                 <div className="text-center text-[11px] text-slate-400 mb-1">在这个轨道聊天不会污染中间的主画布。</div>
                 <div className="flex flex-col gap-3 flex-1 overflow-y-auto mb-2 pr-1">
                   {chatMessages.map((msg, i) => (
                     <div key={i} className={`p-3 rounded-xl max-w-[90%] leading-relaxed text-xs shadow-sm ${msg.role === "user" ? "bg-blue-600 text-white self-end rounded-tr-none" : "bg-white text-slate-700 border border-slate-100 self-start rounded-tl-none"}`}>
                       {msg.text}
                       {i === chatMessages.length - 1 && msg.role === "ai" && (
                         <div className="mt-2.5 pt-2 border-t border-slate-100 flex justify-end">
                           <button onClick={bridgeChatToGeneration} className="text-[11px] bg-blue-50 hover:bg-blue-100 text-blue-600 px-2 py-1 rounded font-bold transition-colors">
                             👉 满意！以此思路切换去生成
                           </button>
                         </div>
                       )}
                     </div>
                   ))}
                 </div>
               </>
             ) : (
               <div className="flex flex-col gap-3">
                 <div className="bg-emerald-50/80 p-4 rounded-xl border border-emerald-200/60 text-emerald-800 text-xs leading-normal">
                   <div className="font-bold mb-1 flex items-center gap-1.5 text-sm">⚡️ 生产力直接成稿模式</div>
                   输入最终确定的选题或想法。大模型会在后台自动提炼特征并**在左侧完成硬性埋点**，同时把结构完备的完整长文**直接注入中央画布**。
                 </div>
               </div>
             )}
           </div>

           {/* 伴随式动态实时建议流（只在右侧底部悬浮） */}
           <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex flex-col gap-2 shrink-0">
             <div className="bg-white border border-slate-200 border-l-2 border-l-amber-500 p-3 rounded-lg shadow-sm text-xs">
               <div className="font-bold text-slate-700 flex items-center gap-1 mb-0.5">💡 思路评审</div>
               <span className="text-slate-400 block mb-1.5 leading-snug">检测到当前框架略显单薄，建议在这里补充一段“防晒霜误区”。</span>
               <button onClick={() => setBody(prev => prev + "\n\n补充细节：注意防晒霜与底妆冲突时可能带来的整体效果缺陷...")} className="bg-amber-50 hover:bg-amber-100 text-amber-700 px-2 py-1 rounded text-[11px] font-bold transition-colors">点击一键塞入正文</button>
             </div>
             
             <div className="bg-white border border-slate-200 border-l-2 border-l-blue-500 p-3 rounded-lg shadow-sm text-xs">
               <div className="font-bold text-slate-700 flex items-center gap-1 mb-0.5">🖼️ 配图建议</div>
               <span className="text-slate-400 block mb-1.5 leading-snug">此处建议插入一张清爽夏日穿搭街拍图作为配图。</span>
               <button onClick={() => setStatus("已为您生成 Midjourney/生图提示词，复制到剪贴板！")} className="bg-blue-50 hover:bg-blue-100 text-blue-700 px-2 py-1 rounded text-[11px] font-bold transition-colors">一键生成文生图提示词</button>
             </div>
           </div>

           {/* 底部全站主输入控制槽 */}
           <div className="p-4 border-t border-slate-200 bg-white shrink-0">
             <textarea
               value={rightTab === "brainstorm" ? chatInputValue : generateInputValue}
               onChange={(e) => rightTab === "brainstorm" ? setChatInputValue(e.target.value) : setGenerateInputValue(e.target.value)}
               placeholder={rightTab === "brainstorm" ? "把这里当做你的草稿桶，随便聊些想法..." : "输入确定的骨架思路（或直接由聊天轨一键导入）..."}
               className="w-full p-2.5 border border-slate-200 rounded-lg outline-none resize-none h-16 text-xs bg-slate-50 text-slate-800 focus:bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-all mb-2"
             />
             <button
                type="button"
                onClick={rightTab === "generate" ? handleSuperGenerate : handleSendChatMessage}
                className={`w-full py-2.5 rounded-lg text-xs font-bold text-white transition-colors flex justify-center items-center shadow-sm ${rightTab === "brainstorm" ? "bg-blue-600 hover:bg-blue-700 shadow-blue-500/10" : "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/10"}`}
             >
               {rightTab === "brainstorm" ? "发送指令给 AI 副驾" : "🚀 释放生产力：直接一键生成图文"}
             </button>
           </div>
        </aside>

      </div>
    </section>
  );
}