"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  PromptScene,
  type PromptDefinitionSummary,
  type PromptEvalComparisonSummary,
  type PromptEvalMetrics,
  type PromptEvalMode,
  type PromptEvalRunSummary,
  type PromptRenderPreviewResult,
  type PromptTestCaseSummary,
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
  Search,
  Send,
  Trash2,
} from "lucide-react";
import {
  activatePromptVersion,
  comparePromptEvalRuns,
  createPrompt,
  createPromptTestCase,
  createPromptVersion,
  deletePromptTestCase,
  getPromptDefinitions,
  getPromptTestCases,
  getPromptVersions,
  renderPromptPreview,
  runPromptEval,
  startPromptEvalJob,
  updatePrompt,
} from "../../lib/api";
import { useAiJob } from "../../lib/use-ai-job";

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

type BusyState = null | "activate" | "preview" | "test" | "eval";
const LLM_EVAL_CASE_LIMIT = 5;
const SAFETY_REVIEW_PROMPT_KEY = "safety_review";

export default function PromptManagePage() {
  const { runJob } = useAiJob();
  const [definitions, setDefinitions] = useState<PromptDefinitionSummary[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [versions, setVersions] = useState<PromptVersionSummary[]>([]);
  const [testCases, setTestCases] = useState<PromptTestCaseSummary[]>([]);
  const [evalRun, setEvalRun] = useState<PromptEvalRunSummary | null>(null);
  const [previousEvalRun, setPreviousEvalRun] = useState<PromptEvalRunSummary | null>(null);
  const [evalVersionId, setEvalVersionId] = useState("");
  const [comparison, setComparison] = useState<PromptEvalComparisonSummary | null>(null);
  const [preview, setPreview] = useState<PromptRenderPreviewResult | null>(null);
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
    temperature: "0.7",
    outputSchema: "",
    template: defaultTemplate,
    changeNote: "",
    previewInput: buildPreviewInput(defaultTemplate),
  });

  const selected = useMemo(
    () => definitions.find((item) => item.key === selectedKey || item.id === selectedKey) ?? null,
    [definitions, selectedKey]
  );

  const extractedVariables = useMemo(() => extractVariables(form.template), [form.template]);
  const variableSignature = useMemo(() => extractedVariables.join("\u0000"), [extractedVariables]);
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
      temperature: String(active?.modelOptions?.temperature ?? "0.7"),
      outputSchema: active?.outputSchema ? JSON.stringify(active.outputSchema, null, 2) : "",
      template: active?.template ?? defaultTemplate,
      changeNote: "",
      previewInput: buildPreviewInput(active?.template ?? defaultTemplate),
    });
    setPreview(null);
    setEvalRun(null);
    setPreviousEvalRun(null);
    setComparison(null);
    setEvalVersionId(active?.id ?? "");
    void loadPromptArtifacts(selected.key);
  }, [selected]);

  useEffect(() => {
    setForm((prev) => {
      const nextPreviewInput = buildPreviewInput(prev.template, prev.previewInput);
      return nextPreviewInput === prev.previewInput ? prev : { ...prev, previewInput: nextPreviewInput };
    });
    setPreview(null);
  }, [variableSignature]);

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
      const [versionItems, caseItems] = await Promise.all([getPromptVersions(key), getPromptTestCases(key, testCaseQuery(key))]);
      setVersions(versionItems);
      setTestCases(caseItems);
      setEvalVersionId((current) =>
        current && versionItems.some((item) => item.id === current)
          ? current
          : versionItems.find((item) => item.status === "active")?.id ?? versionItems[0]?.id ?? ""
      );
    } catch (error) {
      setMessage(errorMessage(error, "Prompt 版本或测试集加载失败"));
    }
  }

  function resetForCreate() {
    setSelectedKey(null);
    setVersions([]);
    setTestCases([]);
    setEvalRun(null);
    setPreviousEvalRun(null);
    setComparison(null);
    setEvalVersionId("");
    setPreview(null);
    setForm({
      key: "new_prompt",
      displayName: "新的 Prompt",
      description: "",
      scene: PromptScene.Generate,
      status: "draft",
      model: "",
      temperature: "0.7",
      outputSchema: "",
      template: defaultTemplate,
      changeNote: "创建新的 Prompt",
      previewInput: buildPreviewInput(defaultTemplate),
    });
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveVersion();
  }

  async function saveVersion() {
    setBusy("activate");
    try {
      const payload = buildVersionPayload();
      if (selected) {
        // 更新 Prompt 定义
        await updatePrompt(selected.id, {
          name: form.displayName.trim() || form.key.trim(),
          description: form.description.trim(),
          scene: form.scene,
        });
        // 创建新版本
        await createPromptVersion(selected.key, payload);
        setMessage("Draft candidate version saved. Run eval before activating it.");
        await loadDefinitions(selected.key);
        await loadPromptArtifacts(selected.key);
      } else {
        const created = await createPrompt({
          name: form.key.trim(),
          scene: form.scene,
          template: form.template,
          variables: extractedVariables,
          model: form.model.trim() || undefined,
          modelOptions: { temperature: parseTemperature(form.temperature) },
          outputSchema: parseOptionalJson(form.outputSchema),
          description: form.description.trim() || undefined,
          changeNote: form.changeNote.trim() || "创建新的 Prompt",
        });
        const newVersions = await getPromptVersions(created.name);
        const latest = newVersions[0];
        if (latest) await activatePromptVersion(created.name, latest.id);
        setMessage("Prompt 已创建并激活");
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
      setMessage("新建 Prompt 需要先保存并激活，再进行渲染预览。");
      return;
    }
    setBusy("preview");
    try {
      const result = await renderPromptPreview(selected.key, {
        template: form.template,
        variables: extractedVariables,
        model: form.model.trim() || undefined,
        modelOptions: { temperature: parseTemperature(form.temperature) },
        outputSchema: parseOptionalJson(form.outputSchema),
        input: parsePreviewInput(form.previewInput, extractedVariables, "预览输入"),
      });
      setPreview(result);
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
        input: parsePreviewInput(form.previewInput, extractedVariables, "测试输入"),
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

  async function handleDeleteTestCase(item: PromptTestCaseSummary) {
    if (!selected) return;
    if (!item.canDelete) {
      setMessage("平台内置测试用例不可删除");
      return;
    }
    if (!window.confirm(`确认删除测试用例「${item.name}」？`)) return;

    setBusy("test");
    try {
      await deletePromptTestCase(selected.key, item.id);
      await loadPromptArtifacts(selected.key);
      setEvalRun(null);
      setPreviousEvalRun(null);
      setComparison(null);
      setMessage("测试用例已删除");
    } catch (error) {
      setMessage(errorMessage(error, "测试用例删除失败"));
    } finally {
      setBusy(null);
    }
  }

  async function handleEvalRun(mode: PromptEvalMode = "dry_run") {
    if (!selected) return;
    const promptKey = selected.key;
    const visibleTestCaseIds = testCases.map((item) => item.id);
    if (!visibleTestCaseIds.length) {
      setMessage("当前没有可回放的测试用例");
      return;
    }
    setBusy("eval");
    try {
      const request = {
        mode,
        versionId: evalVersionId || undefined,
        caseLimit: visibleTestCaseIds.length,
        testCaseIds: visibleTestCaseIds,
      };
      setPreviousEvalRun(evalRun);
      setComparison(null);

      if (mode === "llm_eval") {
        let finalRun: PromptEvalRunSummary | null = null;
        setMessage(`${mode} eval job started`);
        const job = await runJob(
          () => startPromptEvalJob(promptKey, request),
          {
            onProgress: (data) => {
              if (typeof data.message === "string") setMessage(data.message);
            },
            onPartial: (data) => {
              if (data.kind !== "promptEvalRun") return;
              const partialRun = promptEvalRunSummary(data.value);
              if (!partialRun) return;
              finalRun = partialRun;
              setEvalRun(partialRun);
            },
            onDone: (_job, result) => {
              const doneRun = promptEvalRunSummary(result);
              if (!doneRun) return;
              finalRun = doneRun;
              setEvalRun(doneRun);
              setMessage(evalRunMessage(mode, doneRun));
            },
            onError: (message) => setMessage(message),
          }
        );
        const restoredRun = finalRun ?? promptEvalRunSummary(job.result);
        if (restoredRun) {
          setEvalRun(restoredRun);
          setMessage(evalRunMessage(mode, restoredRun));
        } else if (job.status !== "succeeded") {
          setMessage(job.errorMessage ?? "LLM eval job failed");
        }
        return;
      }

      const run = await runPromptEval(promptKey, request);
      setEvalRun(run);
      setMessage(evalRunMessage(mode, run));
    } catch (error) {
      setMessage(errorMessage(error, "测试回放失败"));
    } finally {
      setBusy(null);
    }
  }

  async function handleCompareEvalRuns() {
    if (!selected || !previousEvalRun || !evalRun) return;
    setBusy("eval");
    try {
      const result = await comparePromptEvalRuns(selected.key, previousEvalRun.id, evalRun.id);
      setComparison(result);
      setMessage("回放结果比较已生成");
    } catch (error) {
      setMessage(errorMessage(error, "Eval comparison failed"));
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

  function buildVersionPayload() {
    return {
      template: form.template,
      variables: extractedVariables,
      model: form.model.trim() || undefined,
      modelOptions: { temperature: parseTemperature(form.temperature) },
      outputSchema: parseOptionalJson(form.outputSchema),
      changeNote: form.changeNote.trim() || "Save draft candidate version",
      status: "draft" as const,
    };
  }

  function applyVersionToForm(version: PromptVersionSummary) {
    setForm((prev) => ({
      ...prev,
      model: version.model ?? "",
      temperature: String(version.modelOptions?.temperature ?? "0.7"),
      outputSchema: version.outputSchema ? JSON.stringify(version.outputSchema, null, 2) : "",
      template: version.template,
      changeNote: `基于 v${version.version} 修改`,
      previewInput: buildPreviewInput(version.template, prev.previewInput),
    }));
    setPreview(null);
  }

  return (
    <section className="min-h-full bg-[#f6f6f7] px-4 py-5 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-472 gap-5 grid-cols-[292px_minmax(0,1fr)_340px] 2xl:grid-cols-[300px_minmax(0,1fr)_352px]">
        <aside className="sticky top-[var(--app-page-y)] flex h-[var(--app-sticky-panel-height)] self-start flex-col overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
          <div className="shrink-0 border-b border-slate-100 p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h1 className="text-xl font-bold text-slate-950">Prompt管理</h1>
              <button
                type="button"
                onClick={resetForCreate}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-2xl bg-[#ff2442] px-3 text-sm font-semibold text-white transition hover:bg-[#e91635]"
              >
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

          <div className="prompt-local-scroll min-h-0 flex-1 space-y-5 overflow-y-auto p-4 pr-3">
            {loading ? (
              <div className="grid h-40 place-items-center text-sm text-slate-400">
                正在加载 Prompt...
              </div>
            ) : (
              groupedDefinitions.map((group) => (
                <div key={group.scene}>
                  <div className="mb-2 pl-3 flex items-center justify-between gap-2">
                    <div>
                      <h2 className="text-base font-bold text-slate-900">
                        {sceneLabels[group.scene]}
                      </h2>
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
                          <span className="truncate text-sm text-slate-900">
                            {item.displayName}
                          </span>
                          <StatusBadge status={item.status} />
                        </div>
                        <p className="mt-2 text-xs text-slate-400">
                          v{item.activeVersion?.version ?? 0} · 使用{" "}
                          {item.usageCount} 次
                        </p>
                      </button>
                    ))}
                    {!group.items.length ? (
                      <p className="rounded-2xl bg-slate-50 px-3 py-3 text-xs text-slate-400">
                        暂无模板
                      </p>
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
                      {promptDescriptions[form.key] ??
                        (form.description ||
                          "用于维护一个可版本化、可测试、可激活的 Prompt。")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handlePreview}
                      disabled={Boolean(busy) || !selected}
                      className={secondaryButton()}
                    >
                      {busy === "preview" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                      预览
                    </button>
                    <button
                      type="submit"
                      disabled={Boolean(busy) || !form.template.trim()}
                      className={primaryButton()}
                    >
                      {busy === "activate" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      保存
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-5 p-4 sm:p-5">
                <div
                  className={`rounded-2xl px-4 py-3 text-sm ${message.includes("失败") ? "bg-rose-50 text-rose-700" : "bg-slate-50 text-slate-500"}`}
                >
                  {message}
                </div>

                <section className="rounded-2xl border border-slate-100 p-4">
                  <h3 className="text-base font-bold text-slate-900">
                    基础信息
                  </h3>
                  <div className="mt-4 grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
                    <Field
                      label="Prompt key"
                      value={form.key}
                      disabled={Boolean(selected)}
                      onChange={(value) =>
                        setForm((prev) => ({ ...prev, key: value }))
                      }
                    />
                    <Field
                      label="显示名称"
                      value={form.displayName}
                      onChange={(value) =>
                        setForm((prev) => ({ ...prev, displayName: value }))
                      }
                    />
                    <label className="grid min-w-0 gap-2">
                      <span className="text-sm font-semibold text-slate-700">
                        业务场景
                      </span>
                      <select
                        value={form.scene}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            scene: event.target.value as PromptScene,
                          }))
                        }
                        className={inputClass()}
                      >
                        {sceneOrder.map((scene) => (
                          <option key={scene} value={scene}>
                            {sceneLabels[scene]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Field
                      label="模型"
                      value={form.model}
                      placeholder="默认使用 ARK_MODEL"
                      onChange={(value) =>
                        setForm((prev) => ({ ...prev, model: value }))
                      }
                    />
                  </div>
                  <div className="mt-4 grid min-w-0 grid-cols-1 gap-4 grid-cols-[minmax(0,1fr)_160px]">
                    <VariableTags variables={extractedVariables} />
                    <Field
                      label="temperature"
                      value={form.temperature}
                      onChange={(value) =>
                        setForm((prev) => ({ ...prev, temperature: value }))
                      }
                    />
                  </div>
                  <div className="mt-4">
                    <Field
                      label="描述"
                      value={form.description}
                      onChange={(value) =>
                        setForm((prev) => ({ ...prev, description: value }))
                      }
                    />
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-100 bg-white p-4">
                  <h3 className="text-base font-bold text-slate-900">
                    模板内容
                  </h3>
                  <label className="mt-4 grid min-w-0 gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-700">
                        Prompt 模板
                      </span>
                      <span className="text-xs text-slate-400">
                        {form.template.length} 字符
                      </span>
                    </div>
                    <textarea
                      value={form.template}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          template: event.target.value,
                        }))
                      }
                      rows={20}
                      className="prompt-local-scroll block w-full min-w-0 max-w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-4 font-mono text-sm leading-7 text-slate-800 outline-none focus:border-[#ff2442]/40 focus:bg-white focus:ring-4 focus:ring-[#ff2442]/10"
                    />
                  </label>
                </section>

                <section className="rounded-2xl border border-slate-100 p-4">
                  <h3 className="text-base font-bold text-slate-900">
                    结构化配置
                  </h3>
                  <div className="mt-4 grid min-w-0 grid-cols-1 gap-4 2xl:grid-cols-2">
                    <TextareaField
                      label="输出 Schema JSON"
                      value={form.outputSchema}
                      rows={8}
                      placeholder='{"type":"object","required":["title"]}'
                      onChange={(value) =>
                        setForm((prev) => ({ ...prev, outputSchema: value }))
                      }
                    />
                    <TextareaField
                      label="预览输入 JSON"
                      value={form.previewInput}
                      rows={8}
                      placeholder='{"body":"这里粘贴正文"}'
                      onChange={(value) =>
                        setForm((prev) => ({ ...prev, previewInput: value }))
                      }
                    />
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-100 bg-white p-4">
                  <h3 className="text-base font-bold text-slate-900">
                    版本说明
                  </h3>
                  <div className="mt-4">
                    <Field
                      label="变更说明"
                      value={form.changeNote}
                      placeholder="说明这次 Prompt 改了什么、为什么改"
                      onChange={(value) =>
                        setForm((prev) => ({ ...prev, changeNote: value }))
                      }
                    />
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
              {preview ? (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">
                  {preview.prompt.length} 字符
                </span>
              ) : null}
            </div>
            {preview ? (
              <div className="grid gap-4">
                <div className="space-y-2">
                  {issueCount ? (
                    preview.issues.map((issue, index) => (
                      <div
                        key={`${issue.type}-${issue.variable}-${index}`}
                        className={issueClass(issue.severity)}
                      >
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
                <div className="grid gap-3 md:grid-cols-3">
                  <PreviewMeta
                    label="模板变量"
                    values={preview.variables.map((item) => `{{${item}}}`)}
                    empty="无变量"
                  />
                  <PreviewMeta
                    label="输入变量"
                    values={preview.inputKeys}
                    empty="无输入"
                  />
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm">
                    <p className="text-xs font-semibold text-slate-400">
                      模型参数
                    </p>
                    <p className="mt-2 font-semibold text-slate-700">
                      {preview.model || "默认模型"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      temperature: {formatTemperature(preview.modelOptions)}
                    </p>
                  </div>
                </div>
                <pre className="prompt-local-scroll max-h-96 overflow-auto rounded-2xl bg-slate-950 p-4 text-sm leading-7 text-slate-100">
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

        <aside className="sticky top-[var(--app-page-y)] flex h-[var(--app-sticky-panel-height)] min-h-0 self-start flex-col gap-5 overflow-hidden">
          {/* Section 1: 版本历史 (限制最大高度，内部列表滚动) */}
          <section className="flex min-h-0 basis-[38%] shrink-0 flex-col overflow-hidden rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="mb-3 shrink-0 flex items-center justify-between gap-2">
              <h3 className="inline-flex items-center gap-2 text-xl font-bold text-slate-950">
                <History className="h-4 w-4 text-[#ff2442]" />
                版本历史
              </h3>
              <span className="text-xs text-slate-400">
                {versions.length} 个版本
              </span>
            </div>

            {/* 增加内部滚动容器：flex-1 min-h-0 overflow-y-auto */}
            <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2 prompt-local-scroll">
              {versions.length ? (
                versions.map((version) => (
                  <div
                    key={version.id}
                    className="rounded-2xl border border-slate-100 bg-slate-50 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-slate-900">
                        v{version.version}
                      </span>
                      <StatusBadge status={version.status} />
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                      {version.changeNote || "无变更说明"}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => applyVersionToForm(version)}
                        className="flex-1 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                      >
                        查看
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(busy) || version.status === "active"}
                        onClick={() => void handleActivateVersion(version)}
                        className="flex-1 rounded-xl bg-[#ff2442] px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-rose-200"
                      >
                        激活
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="grid h-28 place-items-center rounded-2xl bg-slate-50 text-sm text-slate-400">
                  暂无版本
                </div>
              )}
            </div>
          </section>

          {/* Section 2: 测试回放 (自适应剩余高度，内部整体滚动) */}
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
              <h3 className="inline-flex items-center gap-2 text-xl font-bold text-slate-950">
                <FlaskConical className="h-4 w-4 text-[#ff2442]" />
                测试回放
              </h3>
              <button
                type="button"
                onClick={handleCreateTestCase}
                disabled={Boolean(busy) || !selected}
                className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                加用例
              </button>
            </div>

            {/* 测试回放本身不滚动，只让测试数据和结果列表各自滚动。 */}
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              {/* 测试数据 */}
              <div className="flex min-h-0 basis-[32%] flex-col overflow-hidden">
                <div className="prompt-local-scroll min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {testCases.length ? (
                  testCases.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-2xl bg-slate-50 p-3 text-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="block truncate font-semibold text-slate-900">
                            {item.name}
                          </span>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span
                              className={`text-xs font-semibold ${item.enabled ? "text-emerald-600" : "text-slate-400"}`}
                            >
                              {item.enabled ? "启用" : "停用"}
                            </span>
                            <span className="text-xs text-slate-300">·</span>
                            <span className="text-xs font-semibold text-slate-400">
                              {item.canDelete ? "用户添加" : "平台内置"}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleDeleteTestCase(item)}
                          disabled={Boolean(busy) || !item.canDelete}
                          title={
                            item.canDelete
                              ? "删除测试用例"
                              : "平台内置用例不可删除"
                          }
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-300"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="grid h-28 place-items-center rounded-2xl bg-slate-50 text-sm text-slate-400">
                    暂无测试用例
                  </div>
                )}
                </div>
              </div>

              <label className="grid shrink-0 gap-2">
                <span className="text-xs font-semibold text-slate-500">
                  评估版本
                </span>
                <select
                  value={evalVersionId}
                  onChange={(event) => setEvalVersionId(event.target.value)}
                  disabled={Boolean(busy) || !versions.length}
                  className={inputClass()}
                >
                  {versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      v{version.version} - {version.status}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid shrink-0 grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void handleEvalRun("dry_run")}
                  disabled={Boolean(busy) || !selected || !testCases.length}
                  className={`${secondaryButton()} justify-center`}
                >
                  {busy === "eval" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  Dry-run
                </button>
                <button
                  type="button"
                  onClick={() => void handleEvalRun("llm_eval")}
                  disabled={Boolean(busy) || !selected || !testCases.length}
                  className={`${primaryButton()} justify-center`}
                >
                  {busy === "eval" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  LLM Eval ({LLM_EVAL_CASE_LIMIT})
                </button>
              </div>

              <button
                type="button"
                onClick={() => void handleCompareEvalRuns()}
                disabled={
                  Boolean(busy) || !selected || !previousEvalRun || !evalRun
                }
                className={`${secondaryButton()} w-full shrink-0 justify-center`}
              >
                比较回放结果
              </button>

              {(evalRun || comparison) ? (
                <div className="prompt-local-scroll min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                  {evalRun ? (
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 text-sm">
                      <p className="font-bold text-slate-900">
                        最近回放：{statusLabels[evalRun.status] ?? evalRun.status}
                      </p>
                      <p className="mt-1 text-slate-500">
                        通过 {evalRun.passed} / {evalRun.total}，失败 {evalRun.failed}
                      </p>
                      <EvalMetrics metrics={evalRun.metrics} />
                      <div className="mt-3 space-y-2">
                        {evalRun.results?.map((item) => (
                          <div
                            key={item.id}
                            className="rounded-xl bg-white px-2 py-1.5 text-xs text-slate-500"
                          >
                            {item.status} · {item.errorMessage ?? "passed"}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {comparison ? (
                    <div className="rounded-2xl border border-slate-100 bg-white p-3 text-sm">
                      <p className="font-bold text-slate-900">回放比较</p>
                      <EvalMetrics metrics={comparison.delta} signed />
                      <p className="mt-2 text-xs text-slate-500">
                        修复 {comparison.fixedCaseIds.length} / 回退 {comparison.regressedCaseIds.length} / 新失败{" "}
                        {comparison.newlyFailedCaseIds.length}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
        </aside>
      </div>
    </section>
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
        className="prompt-local-scroll block w-full min-w-0 max-w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-3 font-mono text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#ff2442]/40 focus:bg-white focus:ring-4 focus:ring-[#ff2442]/10"
      />
    </label>
  );
}

function VariableTags({ variables }: { variables: string[] }) {
  return (
    <div className="grid min-w-0 gap-2">
      <span className="text-sm font-semibold text-slate-700">模板变量</span>
      <div className="min-h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
        {variables.length ? (
          <div className="flex min-w-0 flex-wrap gap-2">
            {variables.map((item) => (
              <span key={item} className="max-w-full break-all rounded-full bg-slate-200 px-2 py-1 text-sm text-slate-800">
                {`{{${item}}}`}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-sm text-slate-400">模板中暂未发现变量</span>
        )}
      </div>
    </div>
  );
}

function PreviewMeta({ label, values, empty }: { label: string; values: string[]; empty: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm">
      <p className="text-xs font-semibold text-slate-400">{label}</p>
      {values.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {values.map((item) => (
            <span key={item} className="max-w-full break-all rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-600">
              {item}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-400">{empty}</p>
      )}
    </div>
  );
}

function EvalMetrics({ metrics, signed = false }: { metrics?: PromptEvalMetrics; signed?: boolean }) {
  const items = [
    ["accuracy", metrics?.accuracy],
    ["recall", metrics?.highRiskRecall],
    ["precision", metrics?.highRiskPrecision],
    ["f1", metrics?.f1],
    ["fp rate", metrics?.falsePositiveRate],
    ["parse", metrics?.parseSuccessRate],
    ["latency", metrics?.avgLatencyMs],
  ] as const;
  const visible = items.filter(([, value]) => typeof value === "number");
  if (!visible.length) return null;

  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      {visible.map(([label, value]) => (
        <div key={label} className="rounded-xl bg-white px-2 py-2">
          <p className="text-[11px] font-semibold uppercase text-slate-400">{label}</p>
          <p className="mt-1 text-sm font-bold text-slate-800">{formatEvalMetric(label, value, signed)}</p>
        </div>
      ))}
    </div>
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

function testCaseQuery(key: string) {
  return key === SAFETY_REVIEW_PROMPT_KEY ? { limit: LLM_EVAL_CASE_LIMIT, sample: "random" as const } : {};
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

function formatEvalMetric(label: string, value: number | undefined, signed: boolean) {
  if (typeof value !== "number") return "-";
  const prefix = signed && value > 0 ? "+" : "";
  if (label === "latency") return `${prefix}${Math.round(value)}ms`;
  return `${prefix}${Math.round(value * 1000) / 10}%`;
}

function extractVariables(template: string) {
  return Array.from(new Set(Array.from(template.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)).map((match) => match[1])));
}

function buildPreviewInput(template: string, previousValue = "") {
  const variables = extractVariables(template);
  const previous = tryParseJsonObject(previousValue) ?? {};
  const input: Record<string, unknown> = {};

  for (const variable of variables) {
    const previousVariableValue = resolvePath(previous, variable);
    assignPath(input, variable, previousVariableValue ?? defaultPreviewValue(variable));
  }

  return JSON.stringify(input, null, 2);
}

function defaultPreviewValue(variable: string) {
  const lower = variable.toLowerCase();
  if (lower.includes("title")) return "示例标题";
  if (lower.includes("body") || lower.includes("text") || lower.includes("content")) {
    return "这里是一段用于测试 Prompt 渲染的正文。";
  }
  if (lower.includes("tone")) return "专业严谨";
  if (lower.includes("style")) return "清晰自然";
  if (lower.includes("tag")) return ["#示例标签"];
  if (lower.includes("risk")) return [];
  if (lower.includes("material") || lower.includes("note")) return "补充素材：用户希望内容更清晰、更有结构。";
  return "";
}

function parsePreviewInput(value: string, variables: string[], label: string): Record<string, unknown> {
  const parsed = tryParseJsonObject(value);
  if (parsed) return parsed;

  const text = value.trim();
  const bodyVariable =
    variables.find((item) => item === "body") ??
    variables.find((item) => item.toLowerCase().includes("body")) ??
    variables.find((item) => item.toLowerCase().includes("text")) ??
    variables[0];

  if (text && bodyVariable) {
    return { [bodyVariable]: text };
  }

  throw new Error(`${label} 格式不是合法 JSON；正文类 Prompt 可直接粘贴纯文本，多个变量时请填写 JSON 对象。`);
}

function tryParseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value || "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function assignPath(target: Record<string, unknown>, key: string, value: unknown) {
  const parts = key.split(".");
  let current = target;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      current[part] = value;
      return;
    }
    if (!current[part] || typeof current[part] !== "object" || Array.isArray(current[part])) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  });
}

function resolvePath(source: Record<string, unknown>, key: string) {
  return key.split(".").reduce<unknown>((current, part) => {
    if (current && typeof current === "object" && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, source);
}

function formatTemperature(modelOptions?: Record<string, unknown> | null) {
  const value = modelOptions?.temperature;
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? String(numberValue) : "默认";
}

function parseTemperature(value: string) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 0.7;
  return Math.min(2, Math.max(0, numberValue));
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

function evalRunMessage(mode: PromptEvalMode, run: PromptEvalRunSummary) {
  const suffix = mode === "llm_eval" ? " sampled cases" : "";
  return `${mode} eval done: passed ${run.passed}/${run.total}${suffix}`;
}

function promptEvalRunSummary(value: unknown): PromptEvalRunSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<PromptEvalRunSummary>;
  if (
    typeof record.id === "string" &&
    typeof record.definitionId === "string" &&
    typeof record.status === "string" &&
    typeof record.total === "number" &&
    typeof record.passed === "number" &&
    typeof record.failed === "number"
  ) {
    return record as PromptEvalRunSummary;
  }
  return null;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
