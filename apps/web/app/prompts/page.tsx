"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { PromptScene } from "@aicp/shared";
import { CheckCircle2, FileText, Loader2, Plus, Save, SlidersHorizontal } from "lucide-react";
import { createPrompt, getPrompts, updatePrompt, type PromptTemplateSummary } from "../../lib/api";

const sceneLabels: Record<PromptScene, string> = {
  [PromptScene.Generate]: "内容生成",
  [PromptScene.Audit]: "安全审核",
  [PromptScene.Score]: "质量评分",
  [PromptScene.Rewrite]: "改写优化",
};

const statusLabels: Record<string, string> = {
  active: "启用",
  draft: "草稿",
  disabled: "停用",
};

const defaultTemplate = `你是今日头条创作者服务平台的 AI 助手。

任务目标：
- 明确用户输入与当前内容上下文
- 输出结构化、可执行、可直接落地的结果
- 避免编造事实，必要时提示用户补充素材

变量示例：
{{title}}
{{body}}
{{materialNotes}}`;

export default function PromptManagePage() {
  const [prompts, setPrompts] = useState<PromptTemplateSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("Prompt 模板用于统一管理 AI 的角色、上下文、输出格式与模型参数。");
  const [form, setForm] = useState({
    name: "",
    scene: PromptScene.Generate,
    status: "draft",
    model: "",
    variables: "",
    temperature: "0.7",
    template: defaultTemplate,
  });

  const selectedPrompt = useMemo(() => prompts.find((item) => item.id === selectedId) ?? null, [prompts, selectedId]);

  useEffect(() => {
    void loadPrompts();
  }, []);

  useEffect(() => {
    if (!selectedPrompt) return;
    const options = selectedPrompt.modelOptions && typeof selectedPrompt.modelOptions === "object"
      ? (selectedPrompt.modelOptions as Record<string, unknown>)
      : {};
    setForm({
      name: selectedPrompt.name,
      scene: selectedPrompt.scene,
      status: selectedPrompt.status,
      model: selectedPrompt.model ?? "",
      variables: Array.isArray(selectedPrompt.variables) ? selectedPrompt.variables.join(", ") : "",
      temperature: String(options.temperature ?? "0.7"),
      template: selectedPrompt.template,
    });
  }, [selectedPrompt]);

  async function loadPrompts() {
    setLoading(true);
    try {
      const items = await getPrompts();
      setPrompts(items);
      setSelectedId((current) => current ?? items[0]?.id ?? null);
      setMessage(`已加载 ${items.length} 个 Prompt 模板`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Prompt 加载失败");
    } finally {
      setLoading(false);
    }
  }

  function resetForCreate() {
    setSelectedId(null);
    setForm({
      name: "new_prompt",
      scene: PromptScene.Generate,
      status: "draft",
      model: "",
      variables: "",
      temperature: "0.7",
      template: defaultTemplate,
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        scene: form.scene,
        template: form.template,
        variables: form.variables
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        model: form.model.trim() || undefined,
        modelOptions: { temperature: Number(form.temperature) || 0.7 },
      };

      if (selectedId) {
        await updatePrompt(selectedId, {
          ...payload,
          status: form.status as "active" | "draft" | "disabled",
        });
        setMessage("Prompt 已保存，版本号已自动递增");
      } else {
        const created = await createPrompt(payload);
        setSelectedId(created.id);
        setMessage("Prompt 已创建为草稿");
      }

      await loadPrompts();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Prompt 保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="min-h-full bg-[#f6f6f7] px-4 py-5 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-[1500px] gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-rose-500">Prompt Center</p>
              <h1 className="mt-1 text-2xl font-black text-slate-950">Prompt 管理</h1>
            </div>
            <button
              type="button"
              onClick={resetForCreate}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-rose-600 px-4 text-sm font-bold text-white transition hover:bg-rose-700"
            >
              <Plus className="h-4 w-4" />
              新建
            </button>
          </div>

          <p className="mb-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-500">{message}</p>

          <div className="space-y-2">
            {loading ? (
              <div className="grid h-40 place-items-center text-sm text-slate-400">正在加载 Prompt...</div>
            ) : prompts.length ? (
              prompts.map((prompt) => (
                <button
                  key={prompt.id}
                  type="button"
                  onClick={() => setSelectedId(prompt.id)}
                  className={`w-full rounded-2xl border p-4 text-left transition ${
                    selectedId === prompt.id
                      ? "border-rose-200 bg-[#fff3f5]"
                      : "border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="truncate text-sm font-black text-slate-900">{prompt.name}</h2>
                    <span className="shrink-0 rounded-full bg-white px-2 py-1 text-xs font-bold text-rose-600">{statusLabels[prompt.status] ?? prompt.status}</span>
                  </div>
                  <p className="mt-2 text-xs font-semibold text-slate-400">
                    {sceneLabels[prompt.scene]} · v{prompt.version} · 使用 {prompt.usageCount} 次
                  </p>
                </button>
              ))
            ) : (
              <div className="grid h-40 place-items-center text-sm text-slate-400">暂无 Prompt 模板</div>
            )}
          </div>
        </aside>

        <main className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-rose-500">
                <SlidersHorizontal className="h-4 w-4" />
                Context & Harness
              </p>
              <h2 className="mt-1 text-2xl font-black text-slate-950">模板编排</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                建议把 Prompt 拆成角色、输入上下文、约束规则、输出 JSON Schema、拒答策略和评估样例。每次修改都记录版本，通过同一批测试样例回放比较稳定性。
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
              {selectedPrompt ? `当前模板：${selectedPrompt.id}` : "正在创建新模板"}
            </div>
          </div>

          <form className="grid gap-5" onSubmit={handleSubmit}>
            <div className="grid gap-4 lg:grid-cols-4">
              <Field label="名称" value={form.name} onChange={(value) => setForm((prev) => ({ ...prev, name: value }))} />
              <label className="grid gap-2">
                <span className="text-sm font-bold text-slate-700">场景</span>
                <select
                  value={form.scene}
                  onChange={(event) => setForm((prev) => ({ ...prev, scene: event.target.value as PromptScene }))}
                  className="h-12 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold outline-none focus:border-rose-300 focus:bg-white"
                >
                  {Object.values(PromptScene).map((scene) => (
                    <option key={scene} value={scene}>
                      {sceneLabels[scene]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-bold text-slate-700">状态</span>
                <select
                  value={form.status}
                  onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
                  className="h-12 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold outline-none focus:border-rose-300 focus:bg-white"
                >
                  <option value="active">启用</option>
                  <option value="draft">草稿</option>
                  <option value="disabled">停用</option>
                </select>
              </label>
              <Field label="模型" value={form.model} placeholder="默认使用 ARK_MODEL" onChange={(value) => setForm((prev) => ({ ...prev, model: value }))} />
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
              <Field label="变量，用逗号分隔" value={form.variables} onChange={(value) => setForm((prev) => ({ ...prev, variables: value }))} />
              <Field label="temperature" value={form.temperature} onChange={(value) => setForm((prev) => ({ ...prev, temperature: value }))} />
            </div>

            <label className="grid gap-2">
              <span className="text-sm font-bold text-slate-700">模板内容</span>
              <textarea
                value={form.template}
                onChange={(event) => setForm((prev) => ({ ...prev, template: event.target.value }))}
                rows={18}
                className="w-full resize-y rounded-3xl border border-slate-200 bg-slate-50 p-4 font-mono text-sm leading-7 text-slate-800 outline-none focus:border-rose-300 focus:bg-white focus:ring-4 focus:ring-rose-50"
              />
            </label>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-slate-50 p-4">
              <div className="flex items-center gap-3 text-sm text-slate-500">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                修改后会影响后端 AI Agent 的下一次调用，请先用样例集回放验证。
              </div>
              <button
                type="submit"
                disabled={saving || !form.name.trim() || !form.template.trim()}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-rose-600 px-6 text-sm font-black text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-rose-300"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                保存模板
              </button>
            </div>
          </form>

          <section className="mt-5 rounded-3xl border border-slate-100 bg-white p-5">
            <h3 className="inline-flex items-center gap-2 text-base font-black text-slate-950">
              <FileText className="h-5 w-5 text-rose-500" />
              后续提升建议
            </h3>
            <div className="mt-3 grid gap-3 text-sm leading-6 text-slate-500 md:grid-cols-3">
              <p>建立固定测试样例集：覆盖直接生成、碰撞思路、标题、审核、改写等任务。</p>
              <p>记录每次 Prompt 修改的目标、样例输入、模型输出、人工评分，形成 Harness 评估表。</p>
              <p>把上下文拆成系统规则、用户输入、素材摘要、历史摘要和输出 Schema，逐项调优。</p>
            </div>
          </section>
        </main>
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-bold text-slate-700">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-12 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-400 focus:border-rose-300 focus:bg-white"
      />
    </label>
  );
}
