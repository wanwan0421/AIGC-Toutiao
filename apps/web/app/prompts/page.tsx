"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  PromptScene,
  type PromptDefinitionSummary,
  type PromptEvalRunSummary,
  type PromptTestCaseSummary,
  type PromptValidationIssue,
  type PromptVersionSummary,
} from "@aicp/shared";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FlaskConical,
  History,
  Loader2,
  Play,
  Plus,
  Save,
  Search,
  Send,
} from "lucide-react";
import {
  activatePromptVersion,
  createPrompt,
  createPromptTestCase,
  createPromptVersion,
  getPromptDefinitions,
  getPromptTestCases,
  getPromptVersions,
  renderPromptPreview,
  runPromptEval,
  updatePrompt,
} from "../../lib/api";

const sceneOrder: PromptScene[] = [PromptScene.Generate, PromptScene.Audit, PromptScene.Score, PromptScene.Rewrite];

const sceneLabels: Record<PromptScene, string> = {
  [PromptScene.Generate]: "创作生成",
  [PromptScene.Audit]: "安全审核",
  [PromptScene.Score]: "质量评分",
  [PromptScene.Rewrite]: "改写优化",
};

const sceneHints: Record<PromptScene, string> = {
  [PromptScene.Generate]: "初稿、标题、对话类 Prompt",
  [PromptScene.Audit]: "内容合规与风险识别",
  [PromptScene.Score]: "多维质量评估",
  [PromptScene.Rewrite]: "选区改写与合规替换",
};

const statusLabels: Record<string, string> = {
  active: "已启用",
  draft: "草稿",
  disabled: "停用",
  archived: "历史",
  running: "运行中",
  succeeded: "成功",
  failed: "失败",
};

const promptTitles: Record<string, string> = {
  direct_generate: "一键图文生成",
  creative_chat: "创作对话助手",
  title_generate: "标题生成",
  selection_polish: "选区润色",
  selection_expand: "选区扩写",
  selection_tone: "选区改语气",
  safety_review: "安全审核",
  quality_score: "质量评分",
  compliance_rewrite: "合规改写",
};

const promptDescriptions: Record<string, string> = {
  direct_generate: "根据主题、人群、风格和素材生成结构化图文初稿，返回标题、正文、标签与配图提示词。",
  creative_chat: "右侧 AI 交互中心使用的多轮对话 Prompt，用于头脑风暴、补写和解释建议。",
  title_generate: "根据当前标题和正文生成标题候选，不读取用户未提供的额外设定。",
  selection_polish: "对编辑器选中文本做表达润色，保持原意不变。",
  selection_expand: "对编辑器选中文本做扩写，补充具体场景、细节或可执行建议。",
  selection_tone: "根据用户选择的语气改写选中文本，保持信息准确。",
  safety_review: "只做安全审核，输出风险片段、风险类型、置信度、原因和建议，不评分、不改写。",
  quality_score: "只做内容质量评分，输出五维评分、总分和理由，作为分发参考。",
  compliance_rewrite: "根据审核风险片段生成整篇合规替代内容和片段级替代表达。",
};

const defaultTemplate = `你是 AI 内容创作平台的中文 Prompt 工程助手。

任务目标：
- 基于用户输入和当前上下文完成指定任务
- 输出结构化、可解析、可直接用于业务流程的结果
- 不编造事实，不输出无关解释

输入：
标题：{{title}}
正文：{{body}}
素材：{{materialNotes}}

请根据任务要求返回结果。`;

const defaultPreviewInput = JSON.stringify(
  {
    title: "示例标题",
    body: "这里是一段用于测试 Prompt 渲染的正文。",
    materialNotes: "补充素材：用户希望内容更清晰、更有结构。",
  },
  null,
  2
);

type BusyState = null | "save" | "activate" | "preview" | "test" | "eval";

export default function PromptManagePage() {
  const [definitions, setDefinitions] = useState<PromptDefinitionSummary[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [versions, setVersions] = useState<PromptVersionSummary[]>([]);
  const [testCases, setTestCases] = useState<PromptTestCaseSummary[]>([]);
  const [evalRun, setEvalRun] = useState<PromptEvalRunSummary | null>(null);
  const [preview, setPreview] = useState<{ prompt: string; issues: PromptValidationIssue[] } | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<BusyState>(null);
  const [message, setMessage] = useState("Prompt 管理台用于维护核心 Prompt、版本、变量、测试集和调用质量。");
  const [form, setForm] = useState({
    key: "",
    displayName: "",
    description: "",
    scene: PromptScene.Generate,
    status: "draft",
    model: "",
    variables: "",
    temperature: "0.7",
    outputSchema: "",
    template: defaultTemplate,
    changeNote: "",
    previewInput: defaultPreviewInput,
  });

  const selected = useMemo(
    () => definitions.find((item) => item.key === selectedKey || item.id === selectedKey) ?? null,
    [definitions, selectedKey]
  );

  const extractedVariables = useMemo(() => extractVariables(form.template), [form.template]);
  const declaredVariablesList = useMemo(() => declaredVariablesFromText(form.variables), [form.variables]);
  const filteredDefinitions = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return definitions;
    return definitions.filter((item) => {
      const title = displayName(item).toLowerCase();
      return (
        title.includes(keyword) ||
        item.key.toLowerCase().includes(keyword) ||
        (item.description ?? "").toLowerCase().includes(keyword)
      );
    });
  }, [definitions, query]);

  const groupedDefinitions = useMemo(
    () =>
      sceneOrder.map((scene) => ({
        scene,
        items: filteredDefinitions.filter((item) => item.scene === scene),
      })),
    [filteredDefinitions]
  );

  const issueCount = preview?.issues.length ?? 0;

  useEffect(() => {
    void loadDefinitions();
  }, []);

  useEffect(() => {
    if (!selected) return;
    const active = selected.activeVersion;
    setForm({
      key: selected.key,
      displayName: selected.displayName,
      description: selected.description ?? "",
      scene: selected.scene,
      status: selected.status,
      model: active?.model ?? "",
      variables: active?.variables?.join(", ") ?? "",
      temperature: String(active?.modelOptions?.temperature ?? "0.7"),
      outputSchema: active?.outputSchema ? JSON.stringify(active.outputSchema, null, 2) : "",
      template: active?.template ?? defaultTemplate,
      changeNote: "",
      previewInput: defaultPreviewInput,
    });
    setPreview(null);
    setEvalRun(null);
    void loadPromptArtifacts(selected.key);
  }, [selected]);

  async function loadDefinitions(nextKey?: string) {
    setLoading(true);
    try {
      const items = await getPromptDefinitions();
      setDefinitions(items);
      const key = nextKey ?? selectedKey ?? items[0]?.key ?? null;
      setSelectedKey(key);
      setMessage(`已加载 ${items.length} 个 Prompt 定义`);
    } catch (error) {
      setMessage(errorMessage(error, "Prompt 加载失败"));
    } finally {
      setLoading(false);
    }
  }

  async function loadPromptArtifacts(key: string) {
    try {
      const [versionItems, caseItems] = await Promise.all([getPromptVersions(key), getPromptTestCases(key)]);
      setVersions(versionItems);
      setTestCases(caseItems);
    } catch (error) {
      setMessage(errorMessage(error, "Prompt 版本或测试集加载失败"));
    }
  }

  function resetForCreate() {
    setSelectedKey(null);
    setVersions([]);
    setTestCases([]);
    setEvalRun(null);
    setPreview(null);
    setForm({
      key: "new_prompt",
      displayName: "新的 Prompt",
      description: "",
      scene: PromptScene.Generate,
      status: "draft",
      model: "",
      variables: "",
      temperature: "0.7",
      outputSchema: "",
      template: defaultTemplate,
      changeNote: "创建新的 Prompt",
      previewInput: defaultPreviewInput,
    });
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveVersion("draft");
  }

  async function saveVersion(status: "draft" | "active") {
    setBusy(status === "active" ? "activate" : "save");
    try {
      const payload = buildVersionPayload(status);
      if (selected) {
        await updatePrompt(selected.id, {
          name: form.displayName.trim() || form.key.trim(),
          description: form.description.trim(),
          scene: form.scene,
          status: status === "active" ? "active" : (form.status as "active" | "draft" | "disabled"),
        });
        const version = await createPromptVersion(selected.key, payload);
        if (status === "active") {
          await activatePromptVersion(selected.key, version.id);
        }
        setMessage(status === "active" ? "新版本已保存并激活，后续 LLM 调用会使用它。" : "草稿版本已保存，暂不影响运行时调用。");
        await loadDefinitions(selected.key);
        await loadPromptArtifacts(selected.key);
      } else {
        const created = await createPrompt({
          name: form.key.trim(),
          scene: form.scene,
          template: form.template,
          variables: declaredVariablesList,
          model: form.model.trim() || undefined,
          modelOptions: { temperature: Number(form.temperature) || 0.7 },
          outputSchema: parseOptionalJson(form.outputSchema),
          description: form.description.trim() || undefined,
          changeNote: form.changeNote.trim() || "创建新的 Prompt",
        });
        if (status === "active") {
          const newVersions = await getPromptVersions(created.name);
          const latest = newVersions[0];
          if (latest) await activatePromptVersion(created.name, latest.id);
        }
        setMessage(status === "active" ? "Prompt 已创建并激活" : "Prompt 已创建为草稿");
        await loadDefinitions(created.name);
      }
    } catch (error) {
      setMessage(errorMessage(error, "Prompt 保存失败"));
    } finally {
      setBusy(null);
    }
  }

  async function handlePreview() {
    if (!selected) {
      setMessage("新建 Prompt 需要先保存草稿，再进行渲染预览。");
      return;
    }
    setBusy("preview");
    try {
      const result = await renderPromptPreview(selected.key, {
        template: form.template,
        variables: declaredVariablesList,
        model: form.model.trim() || undefined,
        modelOptions: { temperature: Number(form.temperature) || 0.7 },
        outputSchema: parseOptionalJson(form.outputSchema),
        input: parseJsonObject(form.previewInput, "预览输入"),
      });
      setPreview({ prompt: result.prompt, issues: result.issues });
      setMessage("渲染预览已生成");
    } catch (error) {
      setMessage(errorMessage(error, "渲染预览失败"));
    } finally {
      setBusy(null);
    }
  }

  async function handleCreateTestCase() {
    if (!selected) return;
    setBusy("test");
    try {
      await createPromptTestCase(selected.key, {
        name: `测试用例 ${testCases.length + 1}`,
        input: parseJsonObject(form.previewInput, "测试输入"),
        assertions: { mustContain: extractedVariables.map((item) => `{{${item}}}`).slice(0, 1) },
        enabled: true,
      });
      await loadPromptArtifacts(selected.key);
      setMessage("测试用例已创建");
    } catch (error) {
      setMessage(errorMessage(error, "测试用例创建失败"));
    } finally {
      setBusy(null);
    }
  }

  async function handleEvalRun() {
    if (!selected) return;
    setBusy("eval");
    try {
      const run = await runPromptEval(selected.key);
      setEvalRun(run);
      setMessage(`测试回放完成：通过 ${run.passed}/${run.total}`);
    } catch (error) {
      setMessage(errorMessage(error, "测试回放失败"));
    } finally {
      setBusy(null);
    }
  }

  async function handleActivateVersion(version: PromptVersionSummary) {
    if (!selected) return;
    setBusy("activate");
    try {
      await activatePromptVersion(selected.key, version.id);
      await loadDefinitions(selected.key);
      await loadPromptArtifacts(selected.key);
      setMessage(`v${version.version} 已激活，后续 LLM 调用会使用该版本。`);
    } catch (error) {
      setMessage(errorMessage(error, "激活版本失败"));
    } finally {
      setBusy(null);
    }
  }

  function buildVersionPayload(status: "draft" | "active") {
    return {
      template: form.template,
      variables: declaredVariablesList,
      model: form.model.trim() || undefined,
      modelOptions: { temperature: Number(form.temperature) || 0.7 },
      outputSchema: parseOptionalJson(form.outputSchema),
      changeNote: form.changeNote.trim() || (status === "active" ? "保存并激活版本" : "保存草稿版本"),
      status,
    };
  }

  function applyVersionToForm(version: PromptVersionSummary) {
    setForm((prev) => ({
      ...prev,
      model: version.model ?? "",
      variables: version.variables.join(", "),
      temperature: String(version.modelOptions?.temperature ?? "0.7"),
      outputSchema: version.outputSchema ? JSON.stringify(version.outputSchema, null, 2) : "",
      template: version.template,
      changeNote: `基于 v${version.version} 修改`,
    }));
    setPreview(null);
  }

  return (
    <section className="min-h-full bg-[#f6f6f7] px-4 py-5 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-440 gap-5 xl:grid-cols-[320px_minmax(0,1fr)_390px]">
          <aside className="h-auto rounded-3xl border border-slate-100 bg-white shadow-sm xl:sticky xl:top-5">
            <div className="border-b border-slate-100 p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h1 className="text-xl font-bold text-slate-950">Prompt管理</h1>
                <button type="button" onClick={resetForCreate} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-2xl bg-[#ff2442] px-3 text-sm font-semibold text-white transition hover:bg-[#e91635]">
                  <Plus className="h-4 w-4" />
                  新建
                </button>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索 key / 名称 / 描述"
                  className="h-10 w-full rounded-2xl border border-slate-100 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-[#ff2442]/40 focus:bg-white focus:ring-4 focus:ring-[#ff2442]/10"
                />
              </div>
            </div>

            <div className="space-y-5 p-4">
              {loading ? (
                <div className="grid h-40 place-items-center text-sm text-slate-400">正在加载 Prompt...</div>
              ) : (
                groupedDefinitions.map((group) => (
                  <div key={group.scene}>
                    <div className="mb-2 pl-3 flex items-center justify-between gap-2">
                      <div>
                        <h2 className="text-base font-bold text-slate-900">{sceneLabels[group.scene]}</h2>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
                        {group.items.length}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {group.items.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setSelectedKey(item.key)}
                          className={`w-full rounded-2xl border p-3 text-left transition ${
                            selected?.id === item.id
                              ? "border-[#ff2442]/20 bg-[#fff3f5]"
                              : "border-slate-100 bg-white hover:border-[#ff2442]/20 hover:bg-[#fff3f5]"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex items-center gap-2">
                              <span className="truncate text-sm text-slate-900">{displayName(item)}</span>
                              <p className="truncate text-xs text-slate-500">{item.key}</p>
                            </div>                            
                            <StatusBadge status={item.status} />
                          </div>
                          <p className="mt-2 text-xs text-slate-400">
                            v{item.activeVersion?.version ?? 0} · 使用 {item.usageCount} 次
                          </p>
                        </button>
                      ))}
                      {!group.items.length ? (
                        <p className="rounded-2xl bg-slate-50 px-3 py-3 text-xs text-slate-400">暂无模板</p>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>

          <main className="min-w-0">
            <form onSubmit={handleSave} className="space-y-5">
              <section className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
                <div className="sticky top-0 z-10 border-b border-slate-100 bg-white/95 px-4 py-4 backdrop-blur sm:px-5">
                  <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="min-w-0 truncate text-xl font-bold text-slate-950">
                          {selected ? displayName(selected) : "新建 Prompt"}
                        </h2>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                          {sceneLabels[form.scene]}
                        </span>
                      </div>
                      <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
                        {promptDescriptions[form.key] ?? (form.description || "用于维护一个可版本化、可测试、可激活的 Prompt。")}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={handlePreview} disabled={Boolean(busy) || !selected} className={secondaryButton()}>
                        {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                        预览
                      </button>
                      <button type="submit" disabled={Boolean(busy) || !form.template.trim()} className={secondaryButton()}>
                        {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        存草稿
                      </button>
                      <button type="button" onClick={() => void saveVersion("active")} disabled={Boolean(busy) || !form.template.trim()} className={primaryButton()}>
                        {busy === "activate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        保存并激活
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-5 p-4 sm:p-5">
                  <div className={`rounded-2xl px-4 py-3 text-sm ${message.includes("失败") ? "bg-rose-50 text-rose-700" : "bg-slate-50 text-slate-500"}`}>
                    {message}
                  </div>

                  <section className="rounded-2xl border border-slate-100 p-4">
                    <h3 className="text-base font-bold text-slate-900">基础信息</h3>
                    <div className="mt-4 grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
                      <Field label="Prompt key" value={form.key} disabled={Boolean(selected)} onChange={(value) => setForm((prev) => ({ ...prev, key: value }))} />
                      <Field label="显示名称" value={form.displayName} onChange={(value) => setForm((prev) => ({ ...prev, displayName: value }))} />
                      <label className="grid min-w-0 gap-2">
                        <span className="text-sm font-semibold text-slate-700">业务场景</span>
                        <select value={form.scene} onChange={(event) => setForm((prev) => ({ ...prev, scene: event.target.value as PromptScene }))} className={inputClass()}>
                          {sceneOrder.map((scene) => (
                            <option key={scene} value={scene}>
                              {sceneLabels[scene]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Field label="模型" value={form.model} placeholder="默认使用 ARK_MODEL" onChange={(value) => setForm((prev) => ({ ...prev, model: value }))} />
                    </div>
                    <div className="mt-4 grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_160px]">
                      <Field label="变量声明，用逗号分隔" value={form.variables} onChange={(value) => setForm((prev) => ({ ...prev, variables: value }))} />
                      <Field label="temperature" value={form.temperature} onChange={(value) => setForm((prev) => ({ ...prev, temperature: value }))} />
                    </div>
                    <div className="mt-4">
                      <Field label="描述" value={form.description} onChange={(value) => setForm((prev) => ({ ...prev, description: value }))} />
                    </div>
                  </section>

                  <section className="rounded-2xl border border-slate-100 bg-white p-4">
                    <h3 className="text-base font-bold text-slate-900">模板内容</h3>
                    <label className="mt-4 grid min-w-0 gap-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-700">Prompt 模板</span>
                        <span className="text-xs text-slate-400">{form.template.length} 字符</span>
                      </div>
                      <textarea
                        value={form.template}
                        onChange={(event) => setForm((prev) => ({ ...prev, template: event.target.value }))}
                        rows={20}
                        className="block w-full min-w-0 max-w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-4 font-mono text-sm leading-7 text-slate-800 outline-none focus:border-[#ff2442]/40 focus:bg-white focus:ring-4 focus:ring-[#ff2442]/10"
                      />
                    </label>
                  </section>

                  <section className="rounded-2xl border border-slate-100 p-4">
                    <h3 className="text-base font-bold text-slate-900">结构化配置</h3>
                    <div className="mt-4 grid min-w-0 grid-cols-1 gap-4 2xl:grid-cols-2">
                      <TextareaField
                        label="输出 Schema JSON"
                        value={form.outputSchema}
                        rows={8}
                        placeholder='{"type":"object","required":["title"]}'
                        onChange={(value) => setForm((prev) => ({ ...prev, outputSchema: value }))}
                      />
                      <TextareaField
                        label="测试输入 Schema JSON"
                        value={form.previewInput}
                        rows={8}
                        onChange={(value) => setForm((prev) => ({ ...prev, previewInput: value }))}
                      />
                    </div>
                  </section>

                  <section className="rounded-2xl border border-slate-100 bg-white p-4">
                    <h3 className="text-base font-bold text-slate-900">版本说明</h3>
                    <div className="mt-4 grid min-w-0 grid-cols-1 gap-4 2xl:grid-cols-2">
                      <Field
                        label="变更说明"
                        value={form.changeNote}
                        placeholder="说明这次 Prompt 改了什么、为什么改"
                        onChange={(value) => setForm((prev) => ({ ...prev, changeNote: value }))}
                      />
                      <div className="grid min-w-0 gap-2">
                        <p className="text-sm font-semibold text-slate-700">自动提取变量</p>
                        <div className="min-h-11 py-2 text-sm text-slate-700">
                          {extractedVariables.length ? (
                            <div className="flex min-w-0 flex-wrap gap-2">
                              {extractedVariables.map((item) => (
                                <span key={item} className="max-w-full break-all rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                                  {`{{${item}}}`}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-slate-400">模板中暂未发现变量</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
              </section>
            </form>
            <section className="mt-5 rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h3 className="inline-flex items-center gap-2 text-lg font-black text-slate-950">
                  <Eye className="h-4 w-4 text-[#ff2442]" />
                  渲染预览
                </h3>
                {preview ? <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">{preview.prompt.length} 字符</span> : null}
              </div>
              {preview ? (
                <div className="grid gap-4">
                  <div className="space-y-2">
                    {issueCount ? (
                      preview.issues.map((issue, index) => (
                        <div key={`${issue.type}-${issue.variable}-${index}`} className={issueClass(issue.severity)}>
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>{issue.message}</span>
                        </div>
                      ))
                    ) : (
                      <div className="flex items-start gap-2 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                        暂未发现变量问题
                      </div>
                    )}
                  </div>
                  <pre className="max-h-96 overflow-auto rounded-2xl bg-slate-950 p-4 text-sm leading-7 text-slate-100">
                    {preview.prompt}
                  </pre>
                </div>
              ) : (
                <div className="grid min-h-40 place-items-center rounded-2xl bg-slate-50 px-5 text-center text-sm leading-6 text-slate-400">
                  选择已保存的 Prompt 后点击“预览”，这里会展示最终渲染结果。
                </div>
              )}
            </section>
          </main>

          <aside className="space-y-5 xl:sticky xl:top-5 xl:max-h-[calc(100vh-2.5rem)] xl:overflow-y-auto">
            <section className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="inline-flex items-center gap-2 text-base font-bold text-slate-950">
                  <History className="h-4 w-4 text-[#ff2442]" />
                  版本历史
                </h3>
                <span className="text-xs text-slate-400">{versions.length} 个版本</span>
              </div>
              <div className="space-y-2">
                {versions.length ? (
                  versions.map((version) => (
                    <div key={version.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold text-slate-900">v{version.version}</span>
                        <StatusBadge status={version.status} />
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{version.changeNote || "无变更说明"}</p>
                      <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => applyVersionToForm(version)} className="flex-1 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">
                          查看
                        </button>
                    <button type="button" disabled={Boolean(busy) || version.status === "active"} onClick={() => void handleActivateVersion(version)} className="flex-1 rounded-xl bg-[#ff2442] px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-rose-200">
                          激活
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="grid h-28 place-items-center rounded-2xl bg-slate-50 text-sm text-slate-400">暂无版本</div>
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="inline-flex items-center gap-2 text-base font-bold text-slate-950">
                  <FlaskConical className="h-4 w-4 text-[#ff2442]" />
                  测试回放
                </h3>
                <button type="button" onClick={handleCreateTestCase} disabled={Boolean(busy) || !selected} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-50">
                  加用例
                </button>
              </div>
              <div className="space-y-2">
                {testCases.length ? (
                  testCases.map((item) => (
                    <div key={item.id} className="rounded-2xl bg-slate-50 p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900">{item.name}</span>
                        <span className={`text-xs font-semibold ${item.enabled ? "text-emerald-600" : "text-slate-400"}`}>
                          {item.enabled ? "启用" : "停用"}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-400">{Object.keys(item.input).join("、") || "无输入变量"}</p>
                    </div>
                  ))
                ) : (
                  <div className="grid h-28 place-items-center rounded-2xl bg-slate-50 text-sm text-slate-400">暂无测试用例</div>
                )}
              </div>
              <button type="button" onClick={handleEvalRun} disabled={Boolean(busy) || !selected || !testCases.length} className={`${primaryButton()} mt-3 w-full justify-center`}>
                {busy === "eval" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                运行 dry-run 回放
              </button>
              {evalRun ? (
                <div className="mt-3 rounded-2xl border border-slate-100 bg-slate-50 p-3 text-sm">
                  <p className="font-bold text-slate-900">最近回放：{statusLabels[evalRun.status] ?? evalRun.status}</p>
                  <p className="mt-1 text-slate-500">
                    通过 {evalRun.passed} / {evalRun.total}，失败 {evalRun.failed}
                  </p>
                  <div className="mt-2 max-h-40 space-y-2 overflow-auto">
                    {evalRun.results?.map((item) => (
                      <div key={item.id} className="rounded-xl bg-white px-2 py-1.5 text-xs text-slate-500">
                        {item.status} · {item.errorMessage ?? "变量检查通过"}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          </aside>
      </div>
    </section>
  );
}

function SectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className="grid min-w-0 gap-2">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <input
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={inputClass()}
      />
    </label>
  );
}

function TextareaField({
  label,
  value,
  onChange,
  rows,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
  placeholder?: string;
}) {
  return (
    <label className="grid min-w-0 gap-2">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="block w-full min-w-0 max-w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-3 font-mono text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#ff2442]/40 focus:bg-white focus:ring-4 focus:ring-[#ff2442]/10"
      />
    </label>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "active"
      ? "bg-emerald-50 text-emerald-700"
      : status === "draft"
        ? "bg-amber-50 text-amber-700"
        : status === "archived"
          ? "bg-slate-100 text-slate-500"
          : "bg-red-50 text-red-700";

  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}>{statusLabels[status] ?? status}</span>;
}

function displayName(item: PromptDefinitionSummary) {
  return promptTitles[item.key] ?? item.displayName;
}

function inputClass() {
  return "h-11 w-full min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#ff2442]/40 focus:bg-white focus:ring-4 focus:ring-[#ff2442]/10 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
}

function primaryButton() {
  return "inline-flex h-10 shrink-0 items-center gap-2 rounded-2xl bg-[#ff2442] px-4 text-sm font-semibold text-white transition hover:bg-[#e91635] disabled:cursor-not-allowed disabled:bg-rose-200";
}

function secondaryButton() {
  return "inline-flex h-10 shrink-0 items-center gap-2 rounded-2xl bg-slate-100 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:text-slate-400";
}

function issueClass(severity: string) {
  if (severity === "error") return "flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700";
  if (severity === "warning") return "flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-700";
  return "flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-500";
}

function extractVariables(template: string) {
  return Array.from(new Set(Array.from(template.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)).map((match) => match[1])));
}

function declaredVariablesFromText(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseOptionalJson(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return parseJsonObject(trimmed, "JSON 配置");
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${label} 必须是 JSON 对象`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message.includes("必须是")) throw error;
    throw new Error(`${label} 格式不是合法 JSON`);
  }
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
