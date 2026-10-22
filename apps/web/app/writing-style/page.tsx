"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronRight, FileText, Pencil, Sparkles } from "lucide-react";
import { buildWritingSkill, confirmWritingSkill, getAiJob, getEligibleWritingSkillContents, getWritingSkill, restoreWritingSkillVersion, unlockWritingSkillProfilePaths, updateWritingSkillProfile, updateWritingSkillSource } from "../../lib/api";

const fields = [
  ["structure", "文章结构"], ["opening", "开头方式"], ["transitions", "段落过渡"], ["ending", "结尾方式"],
  ["tone", "语气"], ["viewpoint", "叙述视角"], ["diction", "措辞习惯"],
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

  return <article className="group rounded-2xl border border-slate-100 bg-white p-4 transition hover:border-rose-100 hover:shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <h4 className="text-sm font-semibold text-slate-800">{label}</h4>
      <div className="flex shrink-0 items-center gap-2">
        {locked && onUnlock && <button type="button" onClick={onUnlock} className="text-xs font-medium text-rose-600 hover:text-rose-700">解除本人锁定</button>}
        <button type="button" onClick={() => setEditing((current) => !current)} aria-label={`${editing ? "完成编辑" : "编辑"}${label}`} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600">
          {editing ? <Check size={15} /> : <Pencil size={15} />}
        </button>
      </div>
    </div>
    {editing
      ? <textarea autoFocus value={value ?? ""} onChange={(event) => onChange(event.target.value)} className="mt-3 min-h-24 w-full resize-y rounded-xl border border-rose-100 bg-rose-50/40 p-3 text-sm leading-6 text-slate-800 outline-none focus:ring-2 focus:ring-rose-100" />
      : <p className="mt-2 text-sm leading-6 text-slate-600" style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{value || "尚未提炼"}</p>}
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
    const showCommonStyle = topics.length > 1;
    const styleTitle = topics.length === 1 ? `${topics[0].label}写作风格` : "个人写作风格";
    const sourceCount = Array.isArray(currentVersion?.sourceManifest) ? currentVersion.sourceManifest.length : 0;
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

      <section className="overflow-hidden rounded-[28px] border border-slate-100 bg-white shadow-sm">
        <div className="relative overflow-hidden border-b border-slate-100 bg-gradient-to-br from-rose-50 via-white to-orange-50 px-5 py-6 sm:px-8 sm:py-8">
          <div className="absolute -right-12 -top-20 h-56 w-56 rounded-full bg-rose-100/50 blur-3xl" />
          <div className="relative flex flex-wrap items-start justify-between gap-5">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-[#ff2442] shadow-sm"><Sparkles size={22} /></div>
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-rose-600">{topics.length === 1 ? "主题风格" : "个人风格"}</span>
                  <span className="rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-slate-600">{sourceCount || topics.reduce((sum: number, topic: any) => sum + (topic.sampleCount ?? 0), 0)} 篇样本</span>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${candidate ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{candidate ? "待确认" : `已启用 · v${skill.activeVersion?.versionNo}`}</span>
                </div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">{styleTitle}</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{candidate ? "根据你选择的文章提炼；检查并编辑后，再确认启用。" : "这份主题风格会在创作时作为写作参考，你可以继续调整。"}</p>
              </div>
            </div>
            <div className="relative flex shrink-0 items-center gap-2 rounded-xl bg-white/80 px-3 py-2 text-xs text-slate-600 shadow-sm">
              <FileText size={15} className="text-rose-500" />
              <span>{candidate ? "候选不会自动生效" : "修改后将保存为新版本"}</span>
            </div>
          </div>
          <div className="relative mt-5 max-w-4xl">
            <EditableStyleField label="风格摘要" value={profile.summary ?? ""} onChange={(value) => setProfile({ ...profile, summary: value })} />
          </div>
        </div>

        {topics.length === 1 && <div className="px-5 pt-6 sm:px-8">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div><p className="text-xs font-semibold text-rose-500">主题表达</p><h3 className="mt-1 text-lg font-semibold text-slate-950">{topics[0].label}的文章节奏</h3></div>
            <span className="text-xs text-slate-500">从开篇到收尾的内容路径</span>
          </div>
          <div className="grid gap-3 xl:grid-cols-4">
            {flowFields.map(([key, label], index) => <div key={key} className="relative">
              {index < flowFields.length - 1 && <div className="absolute left-[calc(100%-10px)] top-7 z-10 hidden h-px w-5 bg-rose-200 xl:block" />}
              <div className="mb-2 flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-100 text-xs font-bold text-rose-600">0{index + 1}</span><ChevronRight size={14} className="text-rose-300 xl:hidden" /></div>
              {renderField(key, label, topics[0].method?.[key] ?? "", `topics.${topics[0].key}.${key}`, (value) => editMethod("topic", 0, key, value))}
            </div>)}
          </div>
          <div className="mt-8 mb-4 flex flex-wrap items-end justify-between gap-2">
            <div><p className="text-xs font-semibold text-slate-400">作者表达</p><h3 className="mt-1 text-lg font-semibold text-slate-950">表达习惯</h3></div>
            <span className="text-xs text-slate-500">描述文章读起来是什么感觉</span>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {voiceFields.map(([key, label]) => renderField(key, label, topics[0].method?.[key] ?? "", `topics.${topics[0].key}.${key}`, (value) => editMethod("topic", 0, key, value)))}
          </div>
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-600">
            <span className="mt-0.5 rounded-lg bg-white p-1.5 text-slate-400"><Sparkles size={15} /></span>
            <p className="leading-6"><span className="font-semibold text-slate-700">通用写作风格尚未建立。</span>目前样本集中在“{topics[0].label}”，因此只展示这类内容的写法；有其他主题样本后，再归纳跨主题稳定的个人表达习惯。</p>
          </div>
        </div>}

        {topics.length > 1 && <div className="space-y-7 px-5 py-6 sm:px-8">
          <div><div className="mb-3"><p className="text-xs font-semibold text-slate-400">作者共通表达</p><h3 className="mt-1 text-lg font-semibold text-slate-950">跨主题的共同表达</h3></div><div className="grid gap-3 md:grid-cols-3">{voiceFields.map(([key, label]) => renderField(key, label, profile.common?.[key] ?? "", `common.${key}`, (value) => editMethod("common", null, key, value)))}</div></div>
          {topics.map((topic: any, index: number) => <div key={topic.key} className="rounded-3xl border border-slate-100 bg-slate-50/70 p-4 sm:p-6"><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-semibold text-slate-950">{topic.label}写作节奏</h3><span className="rounded-full bg-white px-3 py-1 text-xs text-slate-500">{topic.sampleCount} 篇样本</span></div><div className="grid gap-3 xl:grid-cols-4">{flowFields.map(([key, label]) => renderField(key, label, topic.method?.[key] ?? "", `topics.${topic.key}.${key}`, (value) => editMethod("topic", index, key, value)))}</div><div className="mt-4 grid gap-3 md:grid-cols-3">{voiceFields.map(([key, label]) => renderField(key, label, topic.method?.[key] ?? "", `topics.${topic.key}.${key}`, (value) => editMethod("topic", index, key, value)))}</div></div>)}
        </div>}

        {topics.length === 0 && <div className="grid gap-3 px-5 py-6 md:grid-cols-2 sm:px-8">{fields.map(([key, label]) => renderField(key, label, profile.common?.[key] ?? "", `common.${key}`, (value) => editMethod("common", null, key, value)))}</div>}

        <div className="sticky bottom-2 z-20 mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white/95 px-5 py-4 backdrop-blur sm:px-8">
          <span className="text-sm text-slate-500">来源：{sourceCount || "—"} 篇文章</span>
          <button onClick={() => void confirm()} disabled={busy} className="rounded-full bg-[#ff2442] px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#e91635] disabled:cursor-not-allowed disabled:opacity-50">{busy ? "处理中…" : candidate ? "确认并启用" : "保存为新版本"}</button>
        </div>
      </section>

      {(skill?.sources?.length > 0 || skill?.versions?.length > 0) && <div className="grid gap-5 lg:grid-cols-2">
        {skill?.sources?.length > 0 && <section className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm"><div className="border-b border-slate-50 px-5 py-4"><h2 className="text-base font-semibold text-slate-950">样本文章</h2></div><ul className="divide-y divide-slate-50 px-5">{skill.sources.map((source: any) => <li key={source.contentId} className="flex flex-wrap items-center gap-3 py-3 text-sm"><span className="min-w-0 flex-1 truncate font-medium text-slate-800">{source.content?.title ?? "已删除文章"}</span><span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{source.mode === "excluded" ? "已排除" : "已纳入"}</span><button disabled={busy} onClick={() => void changeSource(source.contentId, source.mode === "excluded" ? "manual" : "excluded")} className="font-medium text-[#ff2442] transition hover:text-[#e91635] disabled:opacity-50">{source.mode === "excluded" ? "重新纳入" : "排除"}</button></li>)}</ul></section>}
        {skill?.versions?.length > 0 && <section className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm"><div className="border-b border-slate-50 px-5 py-4"><h2 className="text-base font-semibold text-slate-950">版本记录</h2></div><ul className="divide-y divide-slate-50 px-5">{skill.versions.map((version: any) => <li key={version.id} className="flex flex-wrap items-center gap-3 py-3 text-sm"><span className="flex-1 font-medium text-slate-800">版本 {version.versionNo} · {version.origin === "author_confirmed" || version.origin === "restore" ? "已确认" : "候选"}</span><time className="text-xs text-slate-500">{new Date(version.createdAt).toLocaleString()}</time>{version.id !== skill.activeVersionId && <button disabled={busy} onClick={() => { setBusy(true); void restoreWritingSkillVersion(version.id).then(refresh).catch((e) => setError(e.message)).finally(() => setBusy(false)); }} className="font-medium text-[#ff2442] transition hover:text-[#e91635] disabled:opacity-50">恢复此版本</button>}</li>)}</ul></section>}
      </div>}

      <section className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-50 px-5 py-4 sm:px-6"><div><h2 className="text-base font-semibold text-slate-950">管理样本文章</h2><p className="mt-1 text-sm text-slate-500">选择同一主题的 3–20 篇文章，生成或更新主题写法。</p></div><span className="rounded-full bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-600">已选 <span className="text-slate-950">{selected.length}</span>/20</span></div>
        <ul className="divide-y divide-slate-50 px-5 sm:px-6">{items.map((item) => <li key={item.id} className="-mx-2 flex items-center gap-3 rounded-2xl px-2 py-3 transition hover:bg-slate-50/80"><input aria-label={`选择 ${item.title}`} type="checkbox" className="h-4 w-4 accent-[#ff2442]" disabled={!item.eligible || busy || (!selected.includes(item.id) && selected.length >= 20)} checked={selected.includes(item.id)} onChange={() => toggle(item.id)} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-900">{item.title}</p><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500"><span className="rounded-full bg-slate-100 px-2.5 py-1">{item.visibility === "public" ? "公开" : "非公开"}</span><span>{item.characterCount} 字</span>{item.reason && <span className="text-rose-500">{item.reason}</span>}</div></div></li>)}</ul>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-50 px-5 py-4 sm:px-6"><span className="text-sm text-slate-500">共 {articleTotal} 篇 · 第 {articlePage} 页</span><div className="flex items-center gap-3"><div className="flex gap-2"><button disabled={busy || articlePage <= 1} onClick={() => setArticlePage((value) => Math.max(1, value - 1))} className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40">上一页</button><button disabled={busy || articlePage * 20 >= articleTotal} onClick={() => setArticlePage((value) => value + 1)} className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40">下一页</button></div><button onClick={() => void build()} disabled={busy || selected.length < 3 || selected.length > 20} className="rounded-full bg-[#ff2442] px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#e91635] disabled:cursor-not-allowed disabled:opacity-50">{busy ? "处理中…" : "生成候选写作风格"}</button></div></div>
      </section>
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
