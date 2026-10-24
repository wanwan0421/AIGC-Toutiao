"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, Pencil, Sparkles } from "lucide-react";
import { buildWritingSkill, confirmWritingSkill, getAiJob, getEligibleWritingSkillContents, getWritingSkill, restoreWritingSkillVersion, unlockWritingSkillProfilePaths, updateWritingSkillProfile, updateWritingSkillSource } from "../../lib/api";

const fields = [
  ["structure", "内容安排"], ["opening", "怎么开头"], ["transitions", "怎么衔接"], ["ending", "怎么结尾"],
  ["tone", "说话语气"], ["viewpoint", "叙述角度"], ["diction", "常用表达"],
] as const;

const flowFields = fields.slice(0, 4);
const voiceFields = fields.slice(4);

function EditableStyleField({ label, value, onChange, locked, onUnlock }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  locked?: boolean;
  onUnlock?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const points = (value ?? "").split(/(?<=[；。！？])/u).map((point) => point.trim()).filter(Boolean);
  const visiblePoints = expanded ? points : points.slice(0, 3);

  return <article className="rounded-2xl border border-slate-100 bg-white p-5 sm:p-6">
    <div className="flex items-start justify-between gap-3">
      <h4 className="text-base font-semibold text-slate-900">{label}</h4>
      <div className="flex shrink-0 items-center gap-2">
        {locked && onUnlock && <button type="button" onClick={onUnlock} className="text-xs font-medium text-rose-600 hover:text-rose-700">解除本人锁定</button>}
        <button type="button" onClick={() => setEditing((current) => !current)} aria-label={`${editing ? "完成编辑" : "编辑"}${label}`} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600">
          {editing ? <Check size={15} /> : <Pencil size={15} />}
        </button>
      </div>
    </div>
    {editing
      ? <textarea autoFocus value={value ?? ""} onChange={(event) => onChange(event.target.value)} className="mt-4 min-h-40 w-full resize-y rounded-xl border border-rose-100 bg-rose-50/40 p-4 text-sm leading-7 text-slate-800 outline-none focus:ring-2 focus:ring-rose-100" />
      : points.length > 1 ? <div className="mt-5 space-y-3">
        {visiblePoints.map((point, index) => <div key={`${index}-${point}`} className="flex gap-3 text-sm leading-7 text-slate-700"><span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" /><p>{point}</p></div>)}
        {points.length > 3 && <button type="button" onClick={() => setExpanded((current) => !current)} className="text-sm font-medium text-[#ff2442] hover:text-rose-700">{expanded ? "收起" : `查看全部 ${points.length} 条`}</button>}
      </div> : <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-700">{value || "尚未提炼"}</p>}
  </article>;
}

export default function WritingStylePage() {
  const [skill, setSkill] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [articlePage, setArticlePage] = useState(1);
  const [articleTotal, setArticleTotal] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selectedTopicIndex, setSelectedTopicIndex] = useState(0);
  const [selectedFlow, setSelectedFlow] = useState<string>("structure");
  const [selectedVoice, setSelectedVoice] = useState<string>("tone");
  const refresh = useCallback(async () => {
    const [nextSkill, page] = await Promise.all([getWritingSkill(), getEligibleWritingSkillContents(articlePage, 20)]);
    setSkill(nextSkill); setItems(page.items ?? []); setArticleTotal(page.total ?? 0);
    if (nextSkill.candidateVersion?.profile) setProfile(nextSkill.candidateVersion.profile);
    else if (nextSkill.activeVersion?.profile) setProfile(nextSkill.activeVersion.profile);
  }, [articlePage]);
  useEffect(() => { void refresh().catch((e) => setError(e instanceof Error ? e.message : "加载失败")); }, [refresh]);

  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 20 ? [...current, id] : current);
  const build = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const created = await buildWritingSkill(selected);
      setMessage("正在分析所选文章…");
      let job = created;
      for (let attempt = 0; attempt < 1200; attempt += 1) {
        if (job.status === "succeeded") break;
        if (job.status === "failed" || job.status === "cancelled") throw new Error(job.errorMessage || "写作风格生成失败");
        await new Promise((resolve) => setTimeout(resolve, 1500));
        job = await getAiJob(created.id);
      }
      if (job.status !== "succeeded") throw new Error("生成时间较长，请稍后刷新写作风格页面查看");
      const result = job.result as any;
      setProfile(result.candidateVersion.profile); await refresh(); setMessage("候选写作风格已生成。检查并编辑后再确认生效。");
    }
    catch (e) { setError(e instanceof Error ? e.message : "生成失败"); } finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!profile) return;
    setBusy(true); setError("");
    try {
      if (skill?.candidateVersion) {
        await confirmWritingSkill({ candidateVersionId: skill.candidateVersion.id, editedProfile: profile, expectedSourceRevision: skill.sourceRevision, expectedEditRevision: skill.editRevision });
        await refresh(); setMessage("写作风格已由你确认并启用。");
      } else {
        await updateWritingSkillProfile(profile); await refresh(); setMessage("写作风格修改已保存为新版本。");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "确认失败"); } finally { setBusy(false); }
  };
  const editMethod = (area: "common" | "topic", topicIndex: number | null, field: string, value: string) => setProfile((current: any) => {
    const next = structuredClone(current);
    const target = area === "common" ? next.common : next.topics[topicIndex!].method;
    target[field] = value;
    return next;
  });
  const changeSource = async (id: string, mode: "manual" | "excluded") => {
    setBusy(true); setError("");
    try { await updateWritingSkillSource(id, mode); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "来源更新失败"); } finally { setBusy(false); }
  };

  if (profile && (skill?.candidateVersion || skill?.activeVersion)) {
    const candidate = skill.candidateVersion;
    const currentVersion = candidate ?? skill.activeVersion;
    const topics = profile.topics ?? [];
    const styleTitle = topics.length === 1 ? `${topics[0].label}写作风格` : "个人写作风格";
    const sourceCount = Array.isArray(currentVersion?.sourceManifest) ? currentVersion.sourceManifest.length : 0;
    const activeTopicIndex = topics.length > 1 && selectedTopicIndex === -1 ? -1 : Math.min(Math.max(selectedTopicIndex, 0), Math.max(topics.length - 1, 0));
    const activeTopic = activeTopicIndex < 0 ? null : topics[activeTopicIndex];
    const activeMethod = activeTopic?.method ?? profile.common ?? {};
    const activePath = activeTopic ? `topics.${activeTopic.key}` : "common";
    const activeFlow = flowFields.find(([key]) => key === selectedFlow) ?? flowFields[0];
    const activeVoice = voiceFields.find(([key]) => key === selectedVoice) ?? voiceFields[0];
    const renderField = (key: string, label: string, value: string, path: string, onChange: (next: string) => void) => <EditableStyleField
      key={path}
      label={label}
      value={value}
      onChange={onChange}
      locked={profile.authorLockedPaths?.includes(path)}
      onUnlock={profile.authorLockedPaths?.includes(path) ? () => {
        setBusy(true);
        void unlockWritingSkillProfilePaths([path]).then(refresh).catch((e) => setError(e.message)).finally(() => setBusy(false));
      } : undefined}
    />;

    return <main className="mx-auto min-h-full max-w-350 space-y-5 px-4 py-5 text-slate-950 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-normal text-slate-950">我的写作风格</h1>
      </header>
      {error && <div role="alert" className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {message && <div role="status" className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-700">{message}</div>}
      {skill?.pauseReason && <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800">档案已暂停：{skill.pauseReason}</div>}

      <section className="relative overflow-hidden rounded-[28px] border border-rose-100 bg-gradient-to-r from-rose-50 via-white to-orange-50 p-5 shadow-sm sm:p-7">
        <div className="absolute -right-12 -top-16 h-52 w-52 rounded-full bg-rose-100/50 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-[#ff2442] shadow-sm"><Sparkles size={22} /></div>
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap gap-2 text-xs font-medium">
                <span className="rounded-full bg-white px-3 py-1 text-rose-600">{topics.length === 1 ? "主题风格" : "个人风格"}</span>
                <span className="rounded-full bg-white px-3 py-1 text-slate-600">{sourceCount || topics.reduce((sum: number, topic: any) => sum + (topic.sampleCount ?? 0), 0)} 篇文章</span>
                <span className={`rounded-full px-3 py-1 ${candidate ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{candidate ? "待确认" : `已启用 · v${skill.activeVersion?.versionNo}`}</span>
              </div>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-950">{styleTitle}</h2>
            </div>
          </div>
          <button onClick={() => void confirm()} disabled={busy} className="rounded-full bg-[#ff2442] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#e91635] disabled:opacity-50">{busy ? "处理中…" : candidate ? "确认并启用" : "保存为新版本"}</button>
        </div>
        <details className="group relative mt-6 max-w-3xl rounded-2xl border border-white bg-white/80">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-slate-700"><span className="flex-1">风格概览</span><ChevronDown size={16} className="text-slate-400 transition group-open:rotate-180" /></summary>
          <div className="p-2 pt-0">{renderField("summary", "整体写法", profile.summary ?? "", "summary", (value) => setProfile({ ...profile, summary: value }))}</div>
        </details>
      </section>

      {topics.length > 1 && <div className="flex flex-wrap gap-2" aria-label="选择写作主题">
        {topics.map((topic: any, index: number) => <button key={topic.key} type="button" onClick={() => setSelectedTopicIndex(index)} aria-pressed={activeTopicIndex === index} className={`rounded-full px-4 py-2 text-sm font-medium transition ${activeTopicIndex === index ? "bg-[#ff2442] text-white shadow-sm" : "border border-slate-200 bg-white text-slate-600 hover:border-rose-200 hover:text-rose-600"}`}>{topic.label}</button>)}
        <button type="button" onClick={() => setSelectedTopicIndex(-1)} aria-pressed={activeTopicIndex === -1} className={`rounded-full px-4 py-2 text-sm font-medium transition ${activeTopicIndex === -1 ? "bg-[#ff2442] text-white shadow-sm" : "border border-slate-200 bg-white text-slate-600 hover:border-rose-200 hover:text-rose-600"}`}>共同写法</button>
      </div>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(340px,1fr)]">
        <section className="min-w-0 rounded-[28px] border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
          <h3 className="text-lg font-semibold text-slate-950">文章写法</h3>
          <div className="mt-5 grid gap-4 sm:grid-cols-[150px_minmax(0,1fr)]">
            <div className="grid grid-cols-2 gap-2 self-start sm:grid-cols-1">
              {flowFields.map(([key, label], index) => <button key={key} type="button" onClick={() => setSelectedFlow(key)} aria-pressed={selectedFlow === key} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition ${selectedFlow === key ? "bg-rose-50 text-[#ff2442]" : "text-slate-600 hover:bg-slate-50"}`}><span className={`text-xs font-semibold ${selectedFlow === key ? "text-[#ff2442]" : "text-slate-400"}`}>0{index + 1}</span>{label}<ChevronRight size={14} className="ml-auto hidden sm:block" /></button>)}
            </div>
            {renderField(activeFlow[0], activeFlow[1], activeMethod[activeFlow[0]] ?? "", `${activePath}.${activeFlow[0]}`, (value) => editMethod(activeTopic ? "topic" : "common", activeTopic ? activeTopicIndex : null, activeFlow[0], value))}
          </div>
        </section>
        <section className="min-w-0 rounded-[28px] border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
          <h3 className="text-lg font-semibold text-slate-950">表达习惯</h3>
          <div className="mt-5 flex flex-wrap gap-2">
            {voiceFields.map(([key, label]) => <button key={key} type="button" onClick={() => setSelectedVoice(key)} aria-pressed={selectedVoice === key} className={`rounded-full px-4 py-2 text-sm font-medium transition ${selectedVoice === key ? "bg-rose-50 text-[#ff2442]" : "bg-slate-50 text-slate-600 hover:bg-slate-100"}`}>{label}</button>)}
          </div>
          <div className="mt-4">{renderField(activeVoice[0], activeVoice[1], activeMethod[activeVoice[0]] ?? "", `${activePath}.${activeVoice[0]}`, (value) => editMethod(activeTopic ? "topic" : "common", activeTopic ? activeTopicIndex : null, activeVoice[0], value))}</div>
        </section>
      </div>

      {(skill?.sources?.length > 0 || skill?.versions?.length > 0) && <div className="grid gap-5 lg:grid-cols-2">
        {skill?.sources?.length > 0 && <details className="group self-start overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm"><summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-5"><span className="flex-1 font-semibold text-slate-950">样本文章</span><span className="text-sm text-slate-500">{skill.sources.length} 篇</span><ChevronDown size={17} className="text-slate-400 transition group-open:rotate-180" /></summary><ul className="divide-y divide-slate-50 border-t border-slate-50 px-5">{skill.sources.map((source: any) => <li key={source.contentId} className="flex flex-wrap items-center gap-3 py-3 text-sm"><span className="min-w-0 flex-1 truncate font-medium text-slate-800">{source.content?.title ?? "已删除文章"}</span><span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{source.mode === "excluded" ? "已排除" : "已纳入"}</span><button disabled={busy} onClick={() => void changeSource(source.contentId, source.mode === "excluded" ? "manual" : "excluded")} className="font-medium text-[#ff2442] transition hover:text-[#e91635] disabled:opacity-50">{source.mode === "excluded" ? "重新纳入" : "排除"}</button></li>)}</ul></details>}
        {skill?.versions?.length > 0 && <details className="group self-start overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm"><summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-5"><span className="flex-1 font-semibold text-slate-950">版本记录</span><span className="text-sm text-slate-500">{skill.versions.length} 个版本</span><ChevronDown size={17} className="text-slate-400 transition group-open:rotate-180" /></summary><ul className="divide-y divide-slate-50 border-t border-slate-50 px-5">{skill.versions.map((version: any) => <li key={version.id} className="flex flex-wrap items-center gap-3 py-3 text-sm"><span className="flex-1 font-medium text-slate-800">版本 {version.versionNo} · {version.origin === "author_confirmed" || version.origin === "restore" ? "已确认" : "候选"}</span><time className="text-xs text-slate-500">{new Date(version.createdAt).toLocaleString()}</time>{version.id !== skill.activeVersionId && <button disabled={busy} onClick={() => { setBusy(true); void restoreWritingSkillVersion(version.id).then(refresh).catch((e) => setError(e.message)).finally(() => setBusy(false)); }} className="font-medium text-[#ff2442] transition hover:text-[#e91635] disabled:opacity-50">恢复此版本</button>}</li>)}</ul></details>}
      </div>}

      <details className="group overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-5 sm:px-6"><span className="flex-1 font-semibold text-slate-950">用文章更新风格</span><span className="text-sm text-slate-500">已选 {selected.length}/20</span><ChevronDown size={17} className="text-slate-400 transition group-open:rotate-180" /></summary>
        <ul className="divide-y divide-slate-50 px-5 sm:px-6">{items.map((item) => <li key={item.id} className="-mx-2 flex items-center gap-3 rounded-2xl px-2 py-3 transition hover:bg-slate-50/80"><input aria-label={`选择 ${item.title}`} type="checkbox" className="h-4 w-4 accent-[#ff2442]" disabled={!item.eligible || busy || (!selected.includes(item.id) && selected.length >= 20)} checked={selected.includes(item.id)} onChange={() => toggle(item.id)} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-900">{item.title}</p><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500"><span className="rounded-full bg-slate-100 px-2.5 py-1">{item.visibility === "public" ? "公开" : "非公开"}</span><span>{item.characterCount} 字</span>{item.reason && <span className="text-rose-500">{item.reason}</span>}</div></div></li>)}</ul>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-50 px-5 py-4 sm:px-6"><span className="text-sm text-slate-500">共 {articleTotal} 篇 · 第 {articlePage} 页</span><div className="flex flex-wrap items-center gap-3"><div className="flex gap-2"><button disabled={busy || articlePage <= 1} onClick={() => setArticlePage((value) => Math.max(1, value - 1))} className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40">上一页</button><button disabled={busy || articlePage * 20 >= articleTotal} onClick={() => setArticlePage((value) => value + 1)} className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40">下一页</button></div><button onClick={() => void build()} disabled={busy || selected.length < 3 || selected.length > 20} className="rounded-full bg-[#ff2442] px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#e91635] disabled:cursor-not-allowed disabled:opacity-50">{busy ? "处理中…" : "生成候选写作风格"}</button></div></div>
      </details>
    </main>;
  }

  return <main className="mx-auto min-h-full max-w-350 space-y-6 px-4 py-5 text-slate-950 sm:px-6 lg:px-8">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-2xl font-semibold tracking-normal text-slate-950">我的写作风格</h1>
    </header>
    {error && <div role="alert" className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
    {message && <div role="status" className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-700">{message}</div>}
    {skill?.pauseReason && <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800">档案已暂停：{skill.pauseReason}</div>}
    <section className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-50 px-5 py-4 sm:px-6">
        <div><h2 className="text-base font-semibold text-slate-950">选择已发布文章</h2><p className="mt-1 text-sm text-slate-500">可选 3–20 篇；只读取完整正文不超过 1000 字的文章。</p></div>
        <span className="rounded-full bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-600">已选 <span className="text-slate-950">{selected.length}</span>/20</span>
      </div>
      <ul className="divide-y divide-slate-50 px-5 sm:px-6">{items.map((item) => <li key={item.id} className="-mx-2 flex items-center gap-3 rounded-2xl px-2 py-3 transition hover:bg-slate-50/80">
        <input aria-label={`选择 ${item.title}`} type="checkbox" className="h-4 w-4 accent-[#ff2442]" disabled={!item.eligible || busy || (!selected.includes(item.id) && selected.length >= 20)} checked={selected.includes(item.id)} onChange={() => toggle(item.id)} />
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-900">{item.title}</p><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500"><span className="rounded-full bg-slate-100 px-2.5 py-1">{item.visibility === "public" ? "公开" : "非公开"}</span><span>{item.characterCount} 字</span>{item.reason && <span className="text-rose-500">{item.reason}</span>}</div></div>
      </li>)}</ul>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-50 px-5 py-4 sm:px-6"><span className="text-sm text-slate-500">共 {articleTotal} 篇 · 第 {articlePage} 页</span><div className="flex items-center gap-3"><div className="flex gap-2"><button disabled={busy || articlePage <= 1} onClick={() => setArticlePage((value) => Math.max(1, value - 1))} className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40">上一页</button><button disabled={busy || articlePage * 20 >= articleTotal} onClick={() => setArticlePage((value) => value + 1)} className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40">下一页</button></div><button onClick={() => void build()} disabled={busy || selected.length < 3 || selected.length > 20} className="rounded-full bg-[#ff2442] px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#e91635] disabled:cursor-not-allowed disabled:opacity-50">{busy ? "处理中…" : "生成候选写作风格"}</button></div></div>
    </section>
    {profile && (skill?.candidateVersion || skill?.activeVersion) && <section className="space-y-5 rounded-3xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-50 pb-4"><div><h2 className="text-lg font-semibold text-slate-950">{skill?.candidateVersion ? "检查候选写法" : "当前写作风格"}</h2><p className="mt-1 text-sm text-slate-500">{skill?.candidateVersion ? "候选不会自动生效。修改后由你确认，改过的字段会标记为本人掌控。" : "每次修改都会生成一个新版本。"}</p></div><span className={`rounded-full px-3 py-1 text-xs font-medium ${skill?.candidateVersion ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{skill?.candidateVersion ? "待确认" : `已启用 · v${skill.activeVersion?.versionNo}`}</span></div>
      <label className="block text-sm font-medium text-slate-700">整体概括<textarea className="mt-2 min-h-20 w-full rounded-2xl border border-slate-100 bg-slate-50 p-3 font-normal text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-rose-200 focus:ring-2 focus:ring-rose-100" value={profile.summary} onChange={(e) => setProfile({ ...profile, summary: e.target.value })} /></label>
      <div className="grid gap-4 md:grid-cols-2">{fields.map(([key, label]) => { const path = `common.${key}`; const locked = profile.authorLockedPaths?.includes(path); return <label className="block text-sm font-medium text-slate-700" key={key}>{label}{locked && <button type="button" className="ml-2 text-xs font-medium text-[#ff2442]" onClick={() => { setBusy(true); void unlockWritingSkillProfilePaths([path]).then(refresh).catch((e) => setError(e.message)).finally(() => setBusy(false)); }}>解除本人锁定</button>}<textarea className="mt-2 min-h-20 w-full rounded-2xl border border-slate-100 bg-slate-50 p-3 font-normal text-slate-900 outline-none transition focus:border-rose-200 focus:ring-2 focus:ring-rose-100" value={profile.common[key]} onChange={(e) => editMethod("common", null, key, e.target.value)} /></label>; })}</div>
      {profile.topics?.map((topic: any, index: number) => <div key={topic.key} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4 sm:p-5"><h3 className="font-semibold text-slate-900">{topic.label}写法 <span className="ml-1 rounded-full bg-white px-2 py-0.5 text-xs font-normal text-slate-500">{topic.sampleCount} 篇</span></h3><div className="mt-3 grid gap-3 md:grid-cols-2">{fields.map(([key, label]) => <label className="text-sm font-medium text-slate-700" key={key}>{label}<textarea className="mt-2 min-h-16 w-full rounded-2xl border border-slate-100 bg-white p-3 font-normal text-slate-900 outline-none transition focus:border-rose-200 focus:ring-2 focus:ring-rose-100" value={topic.method[key]} onChange={(e) => editMethod("topic", index, key, e.target.value)} /></label>)}</div></div>)}
      <div className="flex flex-wrap items-center gap-3"><button onClick={() => void confirm()} disabled={busy} className="rounded-full bg-[#ff2442] px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#e91635] disabled:cursor-not-allowed disabled:opacity-50">{skill?.candidateVersion ? "确认并启用" : "保存为新版本"}</button><span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">来源：{Array.isArray((skill.candidateVersion ?? skill.activeVersion).sourceManifest) ? (skill.candidateVersion ?? skill.activeVersion).sourceManifest.length : 0} 篇文章</span></div>
    </section>}
    {(skill?.sources?.length > 0 || skill?.versions?.length > 0) && <div className="grid gap-6 lg:grid-cols-2">
      {skill?.sources?.length > 0 && <section className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm"><div className="border-b border-slate-50 px-5 py-4 sm:px-6"><h2 className="text-base font-semibold text-slate-950">风格来源</h2></div><ul className="divide-y divide-slate-50 px-5 sm:px-6">{skill.sources.map((source: any) => <li key={source.contentId} className="flex flex-wrap items-center gap-3 py-3 text-sm"><span className="min-w-0 flex-1 truncate font-medium text-slate-800">{source.content?.title ?? "已删除文章"}</span><span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{source.mode === "excluded" ? "已排除" : "已纳入"}</span><button disabled={busy} onClick={() => void changeSource(source.contentId, source.mode === "excluded" ? "manual" : "excluded")} className="font-medium text-[#ff2442] transition hover:text-[#e91635] disabled:opacity-50">{source.mode === "excluded" ? "重新纳入" : "排除"}</button></li>)}</ul></section>}
      {skill?.versions?.length > 0 && <section className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm"><div className="border-b border-slate-50 px-5 py-4 sm:px-6"><h2 className="text-base font-semibold text-slate-950">版本记录</h2></div><ul className="divide-y divide-slate-50 px-5 sm:px-6">{skill.versions.map((version: any) => <li key={version.id} className="flex flex-wrap items-center gap-3 py-3 text-sm"><span className="flex-1 font-medium text-slate-800">版本 {version.versionNo} · {version.origin === "author_confirmed" || version.origin === "restore" ? "已确认" : "候选"}</span><time className="text-xs text-slate-500">{new Date(version.createdAt).toLocaleString()}</time>{version.id !== skill.activeVersionId && <button disabled={busy} onClick={() => { setBusy(true); void restoreWritingSkillVersion(version.id).then(refresh).catch((e) => setError(e.message)).finally(() => setBusy(false)); }} className="font-medium text-[#ff2442] transition hover:text-[#e91635] disabled:opacity-50">恢复此版本</button>}</li>)}</ul></section>}
    </div>}
  </main>;
}
