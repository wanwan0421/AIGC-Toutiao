"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ContentStatus, type ContentDetail, type ContentSummary } from "@aicp/shared";
import {
  autosaveDraft,
  createContent,
  generateDraft,
  getContentDetail,
  getContents,
  submitReview,
  updateContent,
} from "../../lib/api";
import {
  BadgeCheck,
  Bold,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Eye,
  FileText,
  FolderOpen,
  Hash,
  Heading1,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  MapPin,
  MessageCircle,
  Quote,
  Redo2,
  Rocket,
  ShieldCheck,
  Smile,
  Sparkles,
  Strikethrough,
  Table2,
  Trash2,
  Undo2,
  Users,
  Wand2,
  X,
} from "lucide-react";

const defaultIdeas = [
  "把主题拆成 3 个可发布角度",
  "补充一个更有冲突感的开头",
  "给正文增加生活化案例",
  "生成 5 个今日头条标题",
];

const topicSuggestions = [
  "#夏日通勤穿搭",
  "#普通人变美思路",
  "#生活方式观察",
  "#职场新人指南",
  "#轻量公式",
];

const activityTopics = [
  {
    title: "# 城市生活灵感季",
    meta: "热度 128",
    cover: "https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=200&q=80",
  },
  {
    title: "# 今日好内容计划",
    meta: "热度 96",
    cover: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=200&q=80",
  },
];

type AiMode = "brainstorm" | "direct";
type PrepTab = "brief" | "assets";
type ImageTarget = "body" | "cover" | "asset";

type SelectionMenu = {
  visible: boolean;
  top: number;
  left: number;
};

const emptySelectionMenu: SelectionMenu = {
  visible: false,
  top: 0,
  left: 0,
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function textToEditorHtml(text: string) {
  if (!text.trim()) {
    return "";
  }

  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

function toDraftSummary(content: ContentDetail): ContentSummary {
  return content;
}

function formatDraftTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "刚刚更新";
  }

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function EditorPage() {
  const router = useRouter();
  const editorRef = useRef<HTMLDivElement | null>(null);
  const selectionRangeRef = useRef<Range | null>(null);
  const pendingEditorHtmlRef = useRef<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [contentId, setContentId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [topic, setTopic] = useState("夏日通勤穿搭");
  const [audience, setAudience] = useState("20-30 岁女性");
  const [style, setStyle] = useState("真实、轻松、有方法感");
  const [viewpoint, setViewpoint] = useState("用轻量公式降低通勤穿搭决策成本");
  const [assetNote, setAssetNote] = useState("可参考小红书/头条穿搭热点、通勤场景照片、用户评论关键词");
  const [prepTab, setPrepTab] = useState<PrepTab>("brief");
  const [aiMode, setAiMode] = useState<AiMode>("brainstorm");
  const [chatInput, setChatInput] = useState("");
  const [statusMessage, setStatusMessage] = useState("编辑器已准备好");
  const [isLoadingInitial, setIsLoadingInitial] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [drafts, setDrafts] = useState<ContentSummary[]>([]);
  const [showDraftList, setShowDraftList] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenu>(emptySelectionMenu);
  const [coverMode, setCoverMode] = useState<"single" | "triple" | "none">("single");
  const [coverPreview, setCoverPreview] = useState("");
  const [imageTarget, setImageTarget] = useState<ImageTarget>("body");
  const [allowCopy, setAllowCopy] = useState(true);
  const [allowCoCreate, setAllowCoCreate] = useState(false);
  const [isOriginal, setIsOriginal] = useState(false);
  const [visibility, setVisibility] = useState<"public" | "friends" | "private">("public");
  const [schedulePublish, setSchedulePublish] = useState(false);

  const wordCount = useMemo(() => body.replace(/\s/g, "").length, [body]);
  const hasSavedDrafts = drafts.length > 0;

  const assistantCards = useMemo(() => {
    const cards = [];

    if (wordCount < 120) {
      cards.push({
        title: "补齐正文骨架",
        desc: "当前正文偏短，建议加入一个真实场景、一个方法清单和一个结尾行动点。",
        action: "插入三段式结构",
      });
    }

    if (!coverPreview && coverMode !== "none") {
      cards.push({
        title: "封面还没准备",
        desc: "头条信息流更依赖首图识别度，可以生成一组清爽、明亮的通勤穿搭配图提示词。",
        action: "生成配图提示",
      });
    }

    if (!title.trim() && body.trim()) {
      cards.push({
        title: "可以生成标题了",
        desc: "AI 已读到正文方向，适合生成 5 个不同力度的标题供你选择。",
        action: "推荐标题",
      });
    }

    return cards.slice(0, 3);
  }, [body, coverMode, coverPreview, title, wordCount]);

  useEffect(() => {
    void loadInitialDrafts();
  }, []);

  useEffect(() => {
    if (!editorRef.current || pendingEditorHtmlRef.current === null) {
      return;
    }

    editorRef.current.innerHTML = pendingEditorHtmlRef.current;
    pendingEditorHtmlRef.current = null;
  }, [isLoadingInitial]);

  useEffect(() => {
    function handleSelectionChange() {
      const selection = window.getSelection();
      const editor = editorRef.current;

      if (!selection || !editor || selection.rangeCount === 0 || !selection.anchorNode) {
        return;
      }

      if (!editor.contains(selection.anchorNode)) {
        return;
      }

      selectionRangeRef.current = selection.getRangeAt(0).cloneRange();
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, []);

  function writeEditorHtml(nextBody: string) {
    const nextHtml = textToEditorHtml(nextBody);
    setBody(nextBody);
    if (editorRef.current) {
      editorRef.current.innerHTML = nextHtml;
      return;
    }

    pendingEditorHtmlRef.current = nextHtml;
  }

  function syncBodyFromEditor(nextStatus?: string) {
    const text = editorRef.current?.textContent ?? "";
    setBody(text);
    if (nextStatus) {
      setStatusMessage(nextStatus);
    }
  }

  function cacheSelectionRange() {
    const selection = window.getSelection();
    const editor = editorRef.current;

    if (!selection || !editor || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      return;
    }

    selectionRangeRef.current = range.cloneRange();
  }

  function restoreSelectionRange() {
    const selection = window.getSelection();
    const editor = editorRef.current;

    if (!selection || !editor) {
      return;
    }

    editor.focus();
    selection.removeAllRanges();

    const cached = selectionRangeRef.current;
    if (cached && editor.contains(cached.commonAncestorContainer)) {
      selection.addRange(cached);
      return;
    }

    const fallbackRange = document.createRange();
    fallbackRange.selectNodeContents(editor);
    fallbackRange.collapse(false);
    selection.addRange(fallbackRange);
  }

  async function loadInitialDrafts() {
    setIsLoadingInitial(true);
    setContentId(null);
    setTitle("");
    writeEditorHtml("");
    try {
      const contents = await getContents();
      const draftItems = contents
        .filter((item) => item.status === ContentStatus.Draft)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      setDrafts(draftItems);

      if (draftItems[0]) {
        setStatusMessage(`检测到 ${draftItems.length} 篇草稿，可按需恢复`);
      } else {
        setStatusMessage("暂无已保存草稿，可以直接开始创作");
      }
    } catch {
      setStatusMessage("草稿加载失败，当前可继续本地编辑");
    } finally {
      setIsLoadingInitial(false);
    }
  }

  async function restoreDraft(id: string, message = "已恢复草稿内容") {
    try {
      const detail = await getContentDetail(id);
      setContentId(detail.id);
      setTitle(detail.title ?? "");
      writeEditorHtml(detail.body ?? "");
      setTopic(detail.tags?.[0] ?? topic);
      setCoverPreview(detail.coverUrl ?? "");
      setStatusMessage(message);
    } catch {
      setStatusMessage("草稿恢复失败，请稍后再试");
    }
  }

  async function persistDraft() {
    setIsBusy(true);
    try {
      const nextBody = editorRef.current?.textContent?.trim() || body;
      const payload = {
        title: title.trim() || "未命名图文草稿",
        body: nextBody || "这里开始记录你的创作正文。",
        tags: topic ? [topic] : [],
      };

      const saved = contentId
        ? await updateContent(contentId, payload)
        : await createContent(payload);

      setContentId(saved.id);
      setTitle(saved.title);
      writeEditorHtml(saved.body);
      setDrafts((items) => {
        const next = [toDraftSummary(saved), ...items.filter((item) => item.id !== saved.id)];
        return next.filter((item) => item.status === ContentStatus.Draft);
      });
      setStatusMessage("草稿已保存");
    } catch {
      setStatusMessage("保存失败，请检查后端服务是否已启动");
    } finally {
      setIsBusy(false);
    }
  }

  async function autoSave() {
    if (!contentId) {
      await persistDraft();
      return;
    }

    setIsBusy(true);
    try {
      const saved = await autosaveDraft(contentId, {
        title: title.trim() || "未命名图文草稿",
        body: editorRef.current?.textContent?.trim() || body || "这里开始记录你的创作正文。",
        payload: {
          tags: topic ? [topic] : [],
          coverPreview,
        },
      });
      void saved;
      setStatusMessage("已同步到草稿箱");
    } catch {
      setStatusMessage("自动保存失败");
    } finally {
      setIsBusy(false);
    }
  }

  async function createAiDraft(source = "brief") {
    setIsBusy(true);
    setStatusMessage("AI 正在生成结构化初稿...");
    try {
      const result = await generateDraft({
        topic,
        style,
        platform: "今日头条",
        tags: topic ? [topic] : [],
        materialNotes: [
          `目标人群：${audience}`,
          `核心观点：${viewpoint}`,
          `素材参考：${assetNote}`,
          source === "direct" ? `最终指令：${chatInput}` : "从基础需求生成完整图文",
        ].join("\n"),
      });
      setTitle(result.title);
      writeEditorHtml(result.body);
      setStatusMessage("AI 初稿已写入中央编辑区，可继续人工修改");
      setChatInput("");
    } catch {
      const fallbackTitle = `${topic}：一套更轻松的实用方法`;
      const fallbackBody = `开头：很多人不是不会搭配，而是每天早上缺少一个稳定、低成本的选择框架。\n\n核心观点：${viewpoint}。\n\n第一部分：先确定今天的场景。通勤、见客户、下班约会，对衣服的要求其实不一样。\n\n第二部分：用一个主色、一个基础款、一个亮点单品完成组合，让整体看起来有重点但不费力。\n\n第三部分：配图建议可以围绕“清爽街拍、通勤包、浅色上衣、自然光”展开。\n\n结尾：把穿搭变成可复用公式，真正节省的是每天出门前的犹豫时间。`;
      setTitle(fallbackTitle);
      writeEditorHtml(fallbackBody);
      setStatusMessage("后端 AI 暂不可用，已写入本地示例初稿");
      setChatInput("");
    } finally {
      setIsBusy(false);
    }
  }

  async function submitForReview() {
    setIsBusy(true);
    try {
      const saved = contentId
        ? await updateContent(contentId, {
            title: title.trim() || "未命名图文草稿",
            body: editorRef.current?.textContent?.trim() || body,
            tags: topic ? [topic] : [],
          })
        : await createContent({
            title: title.trim() || "未命名图文草稿",
            body: editorRef.current?.textContent?.trim() || body,
            tags: topic ? [topic] : [],
          });

      setContentId(saved.id);
      const reviewed = await submitReview(saved.id);
      setStatusMessage(reviewed.content.status === ContentStatus.Published ? "已通过审核并发布" : "已提交审核");
      router.push(`/content/${reviewed.content.id}`);
    } catch {
      setStatusMessage("提交失败，请稍后再试");
    } finally {
      setIsBusy(false);
    }
  }

  function runCommand(command: string, value?: string) {
    restoreSelectionRange();
    const applied = document.execCommand(command, false, value);
    if (!applied && (command === "bold" || command === "italic" || command === "strikeThrough")) {
      const fallbackText = command === "bold" ? "加粗文本" : command === "italic" ? "斜体文本" : "删除线文本";
      const wrapper = command === "bold" ? "strong" : command === "italic" ? "em" : "s";
      document.execCommand("insertHTML", false, `<${wrapper}>${fallbackText}</${wrapper}>`);
    }
    cacheSelectionRange();
    syncBodyFromEditor("已应用编辑格式");
  }

  function insertHtml(html: string, message: string) {
    restoreSelectionRange();
    const inserted = document.execCommand("insertHTML", false, html);

    if (!inserted) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();

        const template = document.createElement("template");
        template.innerHTML = html;
        const fragment = template.content;
        range.insertNode(fragment);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }

    cacheSelectionRange();
    syncBodyFromEditor(message);
    setShowSlashMenu(false);
  }

  function handleEditorInput() {
    const text = editorRef.current?.textContent ?? "";
    setBody(text);
    setShowSlashMenu(text.endsWith("/"));
    setStatusMessage("正在编辑正文");
  }

  function updateSelectionMenu() {
    const selection = window.getSelection();
    const editor = editorRef.current;

    if (!selection || selection.isCollapsed || !editor || !selection.anchorNode || !editor.contains(selection.anchorNode)) {
      setSelectionMenu(emptySelectionMenu);
      return;
    }

    const range = selection.getRangeAt(0);
    cacheSelectionRange();
    const rect = range.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    setSelectionMenu({
      visible: true,
      top: Math.max(8, rect.top - editorRect.top - 44),
      left: Math.max(8, rect.left - editorRect.left),
    });
  }

  function transformSelection(kind: "polish" | "expand" | "tone") {
    restoreSelectionRange();
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      return;
    }

    const selectedText = selection.toString();
    const replacement =
      kind === "polish"
        ? `${selectedText}（表达更清晰、节奏更顺）`
        : kind === "expand"
          ? `${selectedText}。这里可以补充一个具体场景、用户痛点和可执行建议，让读者更容易代入。`
          : `${selectedText}（换成更轻松、有陪伴感的语气）`;

    document.execCommand("insertText", false, replacement);
    cacheSelectionRange();
    syncBodyFromEditor("AI 已处理选中内容");
    setSelectionMenu(emptySelectionMenu);
  }

  function handleImagePick(file: File | undefined) {
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      if (imageTarget === "body") {
        insertHtml(
          `<figure><img src="${dataUrl}" alt="正文配图" /><figcaption>点击图片可继续补充说明</figcaption></figure>`,
          "图片已插入正文"
        );
        if (!coverPreview) {
          setCoverPreview(dataUrl);
        }
        return;
      }

      if (imageTarget === "cover") {
        setCoverPreview(dataUrl);
        setStatusMessage("封面已更新");
        return;
      }

      setCoverPreview((current) => current || dataUrl);
      setStatusMessage("图片素材已加入素材管理");
    };
    reader.readAsDataURL(file);
  }

  function insertLink() {
    const href = window.prompt("请输入链接地址");
    if (!href) {
      return;
    }
    runCommand("createLink", href);
  }

  function insertTable() {
    insertHtml(
      `<table><tbody><tr><th>要点</th><th>说明</th></tr><tr><td>场景</td><td>补充读者会遇到的真实问题</td></tr><tr><td>方法</td><td>给出可执行步骤</td></tr></tbody></table>`,
      "表格已插入正文"
    );
  }

  function insertSlashAction(action: "continue" | "polish" | "tone" | "image") {
    if (action === "continue") {
      insertHtml("<p>接下来可以从一个具体生活场景切入，先写痛点，再给出可复制的方法。</p>", "AI 已续写一段内容");
      return;
    }

    if (action === "polish") {
      insertHtml("<p>这段内容可以进一步压缩表达，让观点更集中、转折更自然。</p>", "AI 已插入润色建议");
      return;
    }

    if (action === "tone") {
      insertHtml("<p>换一种更轻松的语气：别把穿搭当成考试，它更像是给今天的自己选一个舒服的出场方式。</p>", "AI 已插入语气示例");
      return;
    }

    insertHtml("<p><strong>配图建议：</strong>清爽自然光、浅色衬衫、通勤包、街角步行场景，画面留白适合信息流封面。</p>", "AI 已插入配图建议");
  }

  return (
    <section className="min-h-full bg-[#f6f6f7] px-4 py-5 text-slate-950 sm:px-6 lg:px-8">
      <header className="mx-auto mb-5 flex max-w-[1480px] flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="grid size-10 place-items-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-[#ff2442]/30 hover:text-[#ff2442]"
            aria-label="返回"
          >
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-semibold tracking-normal text-slate-950">发布文章</h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-white px-4 py-2 text-sm text-slate-500 shadow-sm">
            {isLoadingInitial ? "正在读取草稿箱" : statusMessage}
          </span>
          <button
            type="button"
            onClick={autoSave}
            disabled={isBusy}
            className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-[#ff2442]/30 hover:text-[#ff2442] disabled:opacity-60"
          >
            保存草稿
          </button>
          <button
            type="button"
            onClick={submitForReview}
            disabled={isBusy}
            className="rounded-full bg-[#ff2442] px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-[#e91635] disabled:opacity-60"
          >
            发布
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1480px] grid-cols-[280px_minmax(0,1fr)_340px] gap-5 xl:items-start max-xl:grid-cols-1">
        <aside className="sticky top-5 rounded-[24px] border border-slate-100 bg-white p-4 shadow-sm max-xl:static">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="mt-1 text-lg font-semibold">创作目标</h2>
          </div>

          <div className="mb-4 grid grid-cols-2 rounded-full bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setPrepTab("brief")}
              className={`rounded-full px-3 py-2 text-sm font-medium transition ${
                prepTab === "brief" ? "bg-white text-[#ff2442] shadow-sm" : "text-slate-500 hover:text-slate-900"
              }`}
            >
              基础需求
            </button>
            <button
              type="button"
              onClick={() => setPrepTab("assets")}
              className={`rounded-full px-3 py-2 text-sm font-medium transition ${
                prepTab === "assets" ? "bg-white text-[#ff2442] shadow-sm" : "text-slate-500 hover:text-slate-900"
              }`}
            >
              素材管理
            </button>
          </div>

          {prepTab === "brief" ? (
            <div className="space-y-3">
              <Field label="主题" value={topic} onChange={setTopic} />
              <Field label="目标人群" value={audience} onChange={setAudience} />
              <Field label="风格" value={style} onChange={setStyle} />
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">核心观点</span>
                <textarea
                  value={viewpoint}
                  onChange={(event) => setViewpoint(event.target.value)}
                  rows={4}
                  className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-[#ff2442]/50 focus:bg-white focus:ring-4 focus:ring-[#ff2442]/10"
                />
              </label>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">参考文本 / 关键词</span>
                <textarea
                  value={assetNote}
                  onChange={(event) => setAssetNote(event.target.value)}
                  rows={7}
                  className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-[#ff2442]/50 focus:bg-white focus:ring-4 focus:ring-[#ff2442]/10"
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  setImageTarget("asset");
                  imageInputRef.current?.click();
                }}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[#ff2442]/30 bg-[#fff3f5] px-4 py-4 text-sm font-medium text-[#ff2442]"
              >
                <ImagePlus size={18} />
                上传图片素材
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => createAiDraft("brief")}
            disabled={isBusy}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#ff2442] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#e91635] disabled:opacity-60"
          >
            <Wand2 size={18} />
            AI 一键生成
          </button>
        </aside>

        <main className="space-y-5">
          {hasSavedDrafts ? (
            <section className="rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-slate-500">
                  检测到 <span className="font-semibold text-slate-700">{drafts.length}</span> 篇草稿，可随时恢复。
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => restoreDraft(drafts[0].id)}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-[#ff2442]/30 hover:text-[#ff2442]"
                  >
                    恢复最近草稿
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDraftList((value) => !value)}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-[#fff3f5] hover:text-[#ff2442]"
                  >
                    草稿列表
                    <ChevronDown size={14} className={showDraftList ? "rotate-180 transition" : "transition"} />
                  </button>
                </div>
              </div>

              {showDraftList ? (
                <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                  {drafts.slice(0, 3).map((draft) => (
                    <button
                      key={draft.id}
                      type="button"
                      onClick={() => restoreDraft(draft.id)}
                      className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition ${
                        draft.id === contentId ? "border-[#ff2442]/30 bg-[#fff6f7]" : "border-slate-100 bg-slate-50 hover:border-[#ff2442]/20"
                      }`}
                    >
                      <span className="line-clamp-1 font-medium text-slate-800">{draft.title || "未命名草稿"}</span>
                      <span className="shrink-0 text-xs text-slate-400">{formatDraftTime(draft.updatedAt)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="rounded-[28px] bg-white p-5 shadow-sm sm:p-7">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div className="flex flex-wrap items-center gap-2">
                <ToolbarButton label="撤销" onClick={() => runCommand("undo")} icon={<Undo2 size={17} />} />
                <ToolbarButton label="重做" onClick={() => runCommand("redo")} icon={<Redo2 size={17} />} />
                <span className="mx-1 h-6 w-px bg-slate-200" />
                <ToolbarButton label="标题" onClick={() => runCommand("formatBlock", "h2")} icon={<Heading1 size={17} />} />
                <ToolbarButton label="加粗" onClick={() => runCommand("bold")} icon={<Bold size={17} />} />
                <ToolbarButton label="斜体" onClick={() => runCommand("italic")} icon={<Italic size={17} />} />
                <ToolbarButton label="引用" onClick={() => runCommand("formatBlock", "blockquote")} icon={<Quote size={17} />} />
                <ToolbarButton label="无序列表" onClick={() => runCommand("insertUnorderedList")} icon={<List size={17} />} />
                <ToolbarButton label="有序列表" onClick={() => runCommand("insertOrderedList")} icon={<ListOrdered size={17} />} />
                <ToolbarButton label="删除线" onClick={() => runCommand("strikeThrough")} icon={<Strikethrough size={17} />} />
                <ToolbarButton label="代码" onClick={() => runCommand("formatBlock", "pre")} icon={<Code2 size={17} />} />
                <ToolbarButton
                  label="图片"
                  onClick={() => {
                    setImageTarget("body");
                    imageInputRef.current?.click();
                  }}
                  icon={<ImagePlus size={17} />}
                />
                <ToolbarButton label="链接" onClick={insertLink} icon={<Link2 size={17} />} />
                <ToolbarButton label="表格" onClick={insertTable} icon={<Table2 size={17} />} />
                <ToolbarButton label="清除格式" onClick={() => runCommand("removeFormat")} icon={<Trash2 size={17} />} />
              </div>
              <button
                type="button"
                onClick={() => createAiDraft("title")}
                disabled={isBusy}
                className="inline-flex items-center gap-2 rounded-full bg-[#fff3f5] px-4 py-2 text-sm font-medium text-[#ff2442] transition hover:bg-[#ffe7eb] disabled:opacity-60"
              >
                <Sparkles size={16} />
                智能标题
                <ChevronDown size={15} />
              </button>
            </div>

            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="填写标题会有更多赞哦"
              maxLength={60}
              className="w-full border-none bg-transparent px-2 py-3 text-2xl font-semibold tracking-normal text-slate-950 outline-none placeholder:text-slate-300"
            />

            <div className="relative rounded-[22px] bg-white px-2 py-3">
              {selectionMenu.visible ? (
                <div
                  className="absolute z-20 flex items-center gap-1 rounded-full border border-slate-100 bg-white p-1 shadow-lg"
                  style={{ top: selectionMenu.top, left: selectionMenu.left }}
                >
                  <MiniAiButton label="润色" onClick={() => transformSelection("polish")} />
                  <MiniAiButton label="扩写" onClick={() => transformSelection("expand")} />
                  <MiniAiButton label="改变风格" onClick={() => transformSelection("tone")} />
                </div>
              ) : null}

              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                onInput={handleEditorInput}
                onMouseUp={updateSelectionMenu}
                onKeyUp={updateSelectionMenu}
                onFocus={cacheSelectionRange}
                onBlur={() => setSelectionMenu(emptySelectionMenu)}
                className="min-h-[420px] w-full cursor-text select-text text-[16px] leading-8 text-slate-800 outline-none empty:before:pointer-events-none empty:before:text-slate-300 empty:before:content-[attr(data-placeholder)] [&_a]:text-[#ff2442] [&_blockquote]:my-4 [&_blockquote]:border-l-4 [&_blockquote]:border-[#ff2442]/30 [&_blockquote]:bg-[#fff7f8] [&_blockquote]:px-4 [&_blockquote]:py-2 [&_figcaption]:mt-2 [&_figcaption]:text-center [&_figcaption]:text-sm [&_figcaption]:text-slate-400 [&_figure]:my-5 [&_h2]:my-4 [&_h2]:text-xl [&_h2]:font-semibold [&_img]:max-h-96 [&_img]:w-full [&_img]:rounded-2xl [&_img]:object-cover [&_li]:my-1 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-3 [&_pre]:my-4 [&_pre]:rounded-2xl [&_pre]:bg-slate-950 [&_pre]:p-4 [&_pre]:text-sm [&_pre]:text-white [&_table]:my-4 [&_table]:w-full [&_table]:overflow-hidden [&_table]:rounded-2xl [&_table]:border [&_table]:border-slate-200 [&_td]:border [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6"
                data-placeholder="输入正文描述，真诚有价值的分享予人温暖。输入 / 唤醒 AI 伴写能力。"
              />

              {showSlashMenu ? (
                <div className="absolute left-6 top-24 z-10 w-72 rounded-2xl border border-slate-100 bg-white p-2 shadow-xl">
                  <SlashAction label="AI 续写" desc="沿着当前段落继续写下去" onClick={() => insertSlashAction("continue")} />
                  <SlashAction label="润色表达" desc="让这段内容更顺、更像人话" onClick={() => insertSlashAction("polish")} />
                  <SlashAction label="改变语气" desc="切换为轻松、专业或种草风" onClick={() => insertSlashAction("tone")} />
                  <SlashAction label="插入配图建议" desc="给当前位置补一段图片方向" onClick={() => insertSlashAction("image")} />
                </div>
              ) : null}
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {topicSuggestions.map((item) => (
                  <button
                    type="button"
                    key={item}
                    onClick={() => setTopic(item.replace("#", ""))}
                    className="rounded-full bg-slate-100 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-[#fff0f2] hover:text-[#ff2442]"
                  >
                    {item}
                  </button>
                ))}
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700"
                >
                  更多
                  <ChevronDown size={14} />
                </button>
              </div>
              <span className="text-sm text-slate-400">{wordCount}/3000</span>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <PillButton icon={<Hash size={16} />} label="话题" />
              <PillButton icon={<Users size={16} />} label="用户" />
              <PillButton icon={<Smile size={16} />} label="表情" />
            </div>
          </section>

          <section className="rounded-[24px] bg-white p-5 shadow-sm sm:p-7">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold">活动话题</h2>
              <button type="button" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-[#ff2442]">
                更多
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {activityTopics.map((item) => (
                <button
                  key={item.title}
                  type="button"
                  className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3 text-left transition hover:bg-[#fff3f5]"
                  onClick={() => setTopic(item.title.replace("# ", ""))}
                >
                  <img src={item.cover} alt="" className="size-14 rounded-xl object-cover" />
                  <div className="min-w-0 flex-1">
                    <h3 className="line-clamp-1 font-semibold">{item.title}</h3>
                    <p className="mt-1 text-sm text-slate-500">{item.meta}</p>
                  </div>
                  <ChevronRight size={18} className="text-slate-400" />
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-[24px] bg-white p-5 shadow-sm sm:p-7">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold">内容设置</h2>
              <button type="button" className="inline-flex items-center gap-1 text-sm text-slate-500">
                收起
                <ChevronDown size={16} />
              </button>
            </div>

            <SettingRow label="展示封面">
              <div className="space-y-3">
                <div className="flex flex-wrap gap-4">
                  <RadioLabel active={coverMode === "single"} label="单图" onClick={() => setCoverMode("single")} />
                  <RadioLabel active={coverMode === "triple"} label="三图" onClick={() => setCoverMode("triple")} />
                  <RadioLabel active={coverMode === "none"} label="无封面" onClick={() => setCoverMode("none")} />
                </div>
                {coverMode !== "none" ? (
                  <div className="flex flex-wrap items-center gap-4">
                    <button
                      type="button"
                      onClick={() => {
                        setImageTarget("cover");
                        imageInputRef.current?.click();
                      }}
                      className="grid size-32 place-items-center overflow-hidden rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-slate-400 transition hover:border-[#ff2442]/40 hover:bg-[#fff3f5] hover:text-[#ff2442]"
                    >
                      {coverPreview ? (
                        <img src={coverPreview} alt="封面预览" className="h-full w-full object-cover" />
                      ) : (
                        <ImagePlus size={28} />
                      )}
                    </button>
                    <p className="max-w-md text-sm leading-6 text-slate-500">
                      优质封面有利于推荐，建议使用明亮、主体清晰的图片。正文插入的第一张图片也可作为封面。
                    </p>
                  </div>
                ) : null}
              </div>
            </SettingRow>

            <SettingRow label="添加位置">
              <button type="button" className="flex w-full max-w-lg items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 text-left text-slate-500">
                标记城市，让更多同城用户看到
                <ChevronDown size={18} />
              </button>
            </SettingRow>

            <SettingRow label="原创声明">
              <Toggle checked={isOriginal} onChange={setIsOriginal} label="声明原创内容" />
            </SettingRow>

            <SettingRow label="添加组件">
              <div className="grid gap-3 md:grid-cols-2">
                <ComponentButton icon={<FolderOpen size={18} />} label="加入合集" />
                <ComponentButton icon={<MessageCircle size={18} />} label="选择群聊" />
                <ComponentButton icon={<CalendarClock size={18} />} label="关联直播预告" />
                <ComponentButton icon={<MapPin size={18} />} label="标记地点或朋友" />
                <ComponentButton icon={<FileText size={18} />} label="选择文件" />
                <ComponentButton icon={<BadgeCheck size={18} />} label="内容类型声明" />
              </div>
            </SettingRow>
          </section>

          <section className="rounded-[24px] bg-white p-5 shadow-sm sm:p-7">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold">更多设置</h2>
              <button type="button" className="inline-flex items-center gap-1 text-sm text-slate-500">
                收起
                <ChevronDown size={16} />
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <ToggleTile icon={<Users size={18} />} label="允许合拍" checked={allowCoCreate} onChange={setAllowCoCreate} />
              <ToggleTile icon={<Copy size={18} />} label="允许正文复制" checked={allowCopy} onChange={setAllowCopy} />
              <button type="button" className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 text-left">
                <span className="inline-flex items-center gap-2">
                  <Eye size={18} />
                  {visibility === "public" ? "公开可见" : visibility === "friends" ? "好友可见" : "仅自己可见"}
                </span>
                <ChevronDown size={18} className="text-slate-400" />
              </button>
              <ToggleTile icon={<CalendarClock size={18} />} label="定时发布" checked={schedulePublish} onChange={setSchedulePublish} />
            </div>
          </section>

          <section className="rounded-[24px] bg-white p-5 shadow-sm sm:p-7">
            <h2 className="mb-5 text-lg font-semibold">发布设置</h2>
            <div className="grid gap-3 md:grid-cols-3">
              <PublishOption active={visibility === "public"} label="公开" onClick={() => setVisibility("public")} />
              <PublishOption active={visibility === "friends"} label="好友可见" onClick={() => setVisibility("friends")} />
              <PublishOption active={visibility === "private"} label="仅自己可见" onClick={() => setVisibility("private")} />
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={submitForReview}
                disabled={isBusy}
                className="rounded-2xl bg-[#ff2442] px-10 py-3 font-semibold text-white transition hover:bg-[#e91635] disabled:opacity-60"
              >
                发布
              </button>
              <button
                type="button"
                onClick={persistDraft}
                disabled={isBusy}
                className="rounded-2xl bg-slate-100 px-10 py-3 font-semibold text-slate-600 transition hover:bg-slate-200 disabled:opacity-60"
              >
                暂存离开
              </button>
            </div>
          </section>
        </main>

        <aside className="sticky top-5 space-y-4 max-xl:static">
          <section className="rounded-[24px] border border-slate-100 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="mt-1 text-lg font-semibold">创作助手</h2>
            </div>

            <div className="mb-4 grid grid-cols-2 rounded-full bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setAiMode("brainstorm")}
                className={`rounded-full px-3 py-2 text-sm font-medium transition ${
                  aiMode === "brainstorm" ? "bg-white text-[#ff2442] shadow-sm" : "text-slate-500 hover:text-slate-900"
                }`}
              >
                碰撞思路
              </button>
              <button
                type="button"
                onClick={() => setAiMode("direct")}
                className={`rounded-full px-3 py-2 text-sm font-medium transition ${
                  aiMode === "direct" ? "bg-white text-[#ff2442] shadow-sm" : "text-slate-500 hover:text-slate-900"
                }`}
              >
                直接生成
              </button>
            </div>

            {aiMode === "brainstorm" ? (
              <div className="space-y-3">
                {defaultIdeas.map((idea) => (
                  <button
                    key={idea}
                    type="button"
                    onClick={() => setChatInput(idea)}
                    className="w-full rounded-2xl bg-slate-50 px-4 py-3 text-left text-sm text-slate-600 transition hover:bg-[#fff3f5] hover:text-[#ff2442]"
                  >
                    {idea}
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl bg-[#fff3f5] p-4 text-sm leading-6 text-[#9f1239]">
                输入确定好的主题或思路，AI 会直接把完整图文写入中央主编辑区，不在右侧堆长文本。
              </div>
            )}

            <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 p-2">
              <textarea
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                rows={4}
                placeholder={aiMode === "brainstorm" ? "输入你的疑问，和 AI 一起拆角度..." : "输入最终主题，AI 将生成完整图文..."}
                className="w-full resize-none bg-transparent p-2 text-sm outline-none placeholder:text-slate-400"
              />
              <button
                type="button"
                onClick={() => {
                  if (aiMode === "direct") {
                    void createAiDraft("direct");
                  } else {
                    insertHtml(`<p><strong>灵感记录：</strong>${escapeHtml(chatInput || "可以从读者真实场景、反差标题和可执行清单三个方向展开。")}</p>`, "灵感已写入正文");
                    setChatInput("");
                  }
                }}
                disabled={isBusy}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff2442] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#e91635] disabled:opacity-60"
              >
                <Sparkles size={16} />
                {aiMode === "direct" ? "生成到编辑区" : "写入灵感"}
              </button>
            </div>
          </section>

          <section className="rounded-[24px] border border-slate-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">伴随式建议</h2>
              <ShieldCheck size={18} className="text-[#ff2442]" />
            </div>
            <div className="space-y-3">
              {assistantCards.map((card) => (
                <button
                  key={card.title}
                  type="button"
                  onClick={() => {
                    if (card.action.includes("标题")) {
                      void createAiDraft("title");
                    } else if (card.action.includes("结构")) {
                      insertHtml("<p><strong>补充结构：</strong>场景痛点 - 实用方法 - 读者行动建议。</p>", "已插入结构建议");
                    } else {
                      insertHtml("<p><strong>文生图提示词：</strong>夏日通勤穿搭，清爽自然光，浅色衬衫，城市街角，真实摄影质感。</p>", "已插入配图提示词");
                    }
                  }}
                  className="w-full rounded-2xl border border-slate-100 bg-slate-50 p-4 text-left transition hover:border-[#ff2442]/20 hover:bg-[#fff3f5]"
                >
                  <h3 className="font-semibold text-slate-900">{card.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-500">{card.desc}</p>
                  <span className="mt-3 inline-flex rounded-full bg-white px-3 py-1 text-xs font-medium text-[#ff2442]">
                    {card.action}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          handleImagePick(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
    </section>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-[#ff2442]/50 focus:bg-white focus:ring-4 focus:ring-[#ff2442]/10"
      />
    </label>
  );
}

function ToolbarButton({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      title={label}
      className="grid size-9 place-items-center rounded-xl text-slate-600 transition hover:bg-[#fff3f5] hover:text-[#ff2442]"
      aria-label={label}
    >
      {icon}
    </button>
  );
}

function MiniAiButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="rounded-full px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-[#fff3f5] hover:text-[#ff2442]"
    >
      {label}
    </button>
  );
}

function SlashAction({ label, desc, onClick }: { label: string; desc: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="block w-full rounded-xl px-3 py-2 text-left transition hover:bg-[#fff3f5]"
    >
      <span className="block text-sm font-semibold text-slate-900">{label}</span>
      <span className="mt-0.5 block text-xs text-slate-500">{desc}</span>
    </button>
  );
}

function PillButton({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-[#fff3f5] hover:text-[#ff2442]"
    >
      {icon}
      {label}
    </button>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-3 border-t border-slate-100 py-5 first:border-t-0 md:grid-cols-[120px_minmax(0,1fr)]">
      <div className="font-semibold text-slate-900">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function RadioLabel({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
      <span className={`grid size-5 place-items-center rounded-full border ${active ? "border-[#ff2442] bg-[#ff2442]" : "border-slate-300 bg-white"}`}>
        <span className="size-2 rounded-full bg-white" />
      </span>
      {label}
    </button>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="inline-flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <span className={`relative h-7 w-12 rounded-full transition ${checked ? "bg-[#ff2442]" : "bg-slate-300"}`}>
        <span className={`absolute top-1 size-5 rounded-full bg-white shadow-sm transition ${checked ? "left-6" : "left-1"}`} />
      </span>
    </button>
  );
}

function ComponentButton({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button type="button" className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 text-left transition hover:bg-[#fff3f5] hover:text-[#ff2442]">
      <span className="inline-flex items-center gap-2">
        {icon}
        {label}
      </span>
      <ChevronRight size={18} className="text-slate-400" />
    </button>
  );
}

function ToggleTile({
  icon,
  label,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 text-left transition hover:bg-[#fff3f5]">
      <span className="inline-flex items-center gap-2">
        {icon}
        {label}
      </span>
      <span className={`relative h-7 w-12 rounded-full transition ${checked ? "bg-[#ff2442]" : "bg-slate-300"}`}>
        <span className={`absolute top-1 size-5 rounded-full bg-white shadow-sm transition ${checked ? "left-6" : "left-1"}`} />
      </span>
    </button>
  );
}

function PublishOption({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-left font-medium transition ${
        active ? "bg-[#fff3f5] text-[#ff2442]" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
      }`}
    >
      <span className={`grid size-5 place-items-center rounded-full border ${active ? "border-[#ff2442] bg-[#ff2442]" : "border-slate-300 bg-white"}`}>
        <span className="size-2 rounded-full bg-white" />
      </span>
      {label}
    </button>
  );
}
