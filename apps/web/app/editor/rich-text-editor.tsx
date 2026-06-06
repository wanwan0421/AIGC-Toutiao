"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Editor, JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import StarterKit from "@tiptap/starter-kit";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  Redo2,
  Table2,
  Trash2,
  Undo2,
} from "lucide-react";

export type RichTextValue = {
  text: string;
  html: string;
  json: JSONContent;
};

export type RichTextSelection = {
  text: string;
  top: number;
  left: number;
};

export type RichTextEditorHandle = {
  focus: () => void;
  isFocused: () => boolean;
  getValue: () => RichTextValue;
  getText: () => string;
  getHTML: () => string;
  getJSON: () => JSONContent;
  getSelectedText: () => string;
  setContent: (content: RichTextInitialContent) => void;
  insertHTML: (html: string) => void;
  insertText: (text: string) => void;
  insertTextAtEnd: (text: string) => void;
  insertImage: (src: string, alt?: string) => void;
  replaceSelection: (text: string) => void;
  replaceTextRange: (input: RichTextReplaceInput) => boolean;
  replaceTextRanges: (inputs: RichTextReplaceInput[]) => number;
};

export type RichTextReplaceInput = {
  original: string;
  replacement: string;
  startOffset?: number;
  endOffset?: number;
};

export type RichTextInitialContent = {
  html?: string | null;
  json?: JSONContent | Record<string, unknown> | null;
  text?: string | null;
};

type RichTextEditorProps = {
  initialContent: RichTextInitialContent;
  resetKey: number;
  placeholder?: string;
  onChange: (value: RichTextValue) => void;
  onSelectionChange?: (selection: RichTextSelection | null) => void;
  onSaveShortcut?: () => void;
  onOpenImageUpload?: () => void;
};

const selectionHighlightName = "aicp-tiptap-selection";

function textToHtml(text: string) {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function resolveInitialContent(content: RichTextInitialContent) {
  if (content.json && typeof content.json === "object") return content.json as JSONContent;
  if (content.html?.trim()) return content.html;
  if (content.text?.trim()) return textToHtml(content.text);
  return "";
}

function editorValue(editor: Editor): RichTextValue {
  return {
    text: editor.getText({ blockSeparator: "\n\n" }),
    html: editor.getHTML(),
    json: editor.getJSON(),
  };
}

function buildPlainTextPositionMap(editor: Editor) {
  const positions: number[] = [];
  let text = "";
  let lastTextEnd: number | null = null;

  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;

    if (lastTextEnd !== null && pos > lastTextEnd && text.length > 0 && !text.endsWith("\n\n")) {
      positions[text.length] = lastTextEnd;
      text += "\n";
      positions[text.length] = lastTextEnd;
      text += "\n";
    }

    for (let index = 0; index < node.text.length; index += 1) {
      positions[text.length] = pos + index;
      text += node.text[index];
    }
    lastTextEnd = pos + node.text.length;
  });

  positions[text.length] = lastTextEnd ?? 0;
  return { text, positions };
}

function replaceTextRange(editor: Editor, input: RichTextReplaceInput) {
  if (!input.replacement) return false;
  const original = input.original;
  const { text, positions } = buildPlainTextPositionMap(editor);
  let start = -1;
  let end = -1;

  if (
    original &&
    input.startOffset !== undefined &&
    input.endOffset !== undefined &&
    text.slice(input.startOffset, input.endOffset) === original
  ) {
    start = input.startOffset;
    end = input.endOffset;
  } else if (original) {
    start = text.indexOf(original);
    end = start >= 0 ? start + original.length : -1;
  }

  const from = positions[start];
  const to = positions[end];
  if (start < 0 || end < 0 || from === undefined || to === undefined || from > to) return false;

  editor.chain().focus().setTextSelection({ from, to }).insertContent(input.replacement).run();
  return true;
}

function highlightRegistry() {
  if (typeof window === "undefined" || typeof CSS === "undefined") return null;
  const registry = (CSS as unknown as {
    highlights?: {
      set: (name: string, highlight: unknown) => void;
      delete: (name: string) => void;
    };
  }).highlights;
  const HighlightCtor = (window as typeof window & {
    Highlight?: new (...ranges: Range[]) => unknown;
  }).Highlight;
  return registry && HighlightCtor ? { registry, HighlightCtor } : null;
}

function clearSelectionHighlight() {
  highlightRegistry()?.registry.delete(selectionHighlightName);
}

function paintSelectionHighlight(editor: Editor, from: number, to: number) {
  const api = highlightRegistry();
  if (!api || from === to) return;

  try {
    const start = editor.view.domAtPos(from);
    const end = editor.view.domAtPos(to);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    api.registry.set(selectionHighlightName, new api.HighlightCtor(range));
  } catch {
    clearSelectionHighlight();
  }
}

function editorContentClassName(readonly = false) {
  return [
    "editor-surface-wrapper",
    "[&_.ProseMirror]:min-h-130 [&_.ProseMirror]:max-w-full [&_.ProseMirror]:rounded-2xl [&_.ProseMirror]:px-2 [&_.ProseMirror]:py-5 [&_.ProseMirror]:text-base [&_.ProseMirror]:leading-8 [&_.ProseMirror]:text-slate-800 [&_.ProseMirror]:outline-none",
    readonly ? "[&_.ProseMirror]:min-h-0 [&_.ProseMirror]:p-0" : "",
    "[&_.ProseMirror_p]:my-3 [&_.ProseMirror_h1]:mb-5 [&_.ProseMirror_h1]:mt-7 [&_.ProseMirror_h1]:text-2xl [&_.ProseMirror_h1]:font-black [&_.ProseMirror_h1]:leading-tight [&_.ProseMirror_h2]:mb-4 [&_.ProseMirror_h2]:mt-6 [&_.ProseMirror_h2]:text-xl [&_.ProseMirror_h2]:font-black [&_.ProseMirror_h3]:mb-3 [&_.ProseMirror_h3]:mt-5 [&_.ProseMirror_h3]:text-lg [&_.ProseMirror_h3]:font-bold",
    "[&_.ProseMirror_ul]:my-4 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_ol]:my-4 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6 [&_.ProseMirror_li]:my-1",
    "[&_.ProseMirror_blockquote]:my-5 [&_.ProseMirror_blockquote]:border-l-4 [&_.ProseMirror_blockquote]:border-[#ff2442]/30 [&_.ProseMirror_blockquote]:bg-[#fff3f5] [&_.ProseMirror_blockquote]:px-4 [&_.ProseMirror_blockquote]:py-2 [&_.ProseMirror_blockquote]:text-rose-900",
    "[&_.ProseMirror_code]:rounded [&_.ProseMirror_code]:bg-slate-100 [&_.ProseMirror_code]:px-1.5 [&_.ProseMirror_code]:py-0.5 [&_.ProseMirror_code]:text-sm [&_.ProseMirror_code]:text-slate-700",
    "[&_.ProseMirror_img]:my-5 [&_.ProseMirror_img]:max-w-full [&_.ProseMirror_img]:rounded-2xl",
    "[&_.ProseMirror_.tableWrapper]:my-5 [&_.ProseMirror_.tableWrapper]:max-w-full [&_.ProseMirror_.tableWrapper]:overflow-x-auto [&_.ProseMirror_.tableWrapper]:rounded-xl",
    "[&_.ProseMirror_table]:my-5 [&_.ProseMirror_table]:w-full [&_.ProseMirror_table]:max-w-full [&_.ProseMirror_table]:table-fixed [&_.ProseMirror_table]:border-collapse [&_.ProseMirror_table]:overflow-hidden [&_.ProseMirror_table]:rounded-xl [&_.ProseMirror_table]:text-left",
    "[&_.ProseMirror_th]:min-w-0 [&_.ProseMirror_th]:break-words [&_.ProseMirror_th]:border [&_.ProseMirror_th]:border-slate-200 [&_.ProseMirror_th]:bg-slate-50 [&_.ProseMirror_th]:px-3 [&_.ProseMirror_th]:py-2 [&_.ProseMirror_th]:font-bold [&_.ProseMirror_th]:whitespace-normal [&_.ProseMirror_td]:min-w-0 [&_.ProseMirror_td]:break-words [&_.ProseMirror_td]:border [&_.ProseMirror_td]:border-slate-200 [&_.ProseMirror_td]:px-3 [&_.ProseMirror_td]:py-2 [&_.ProseMirror_td]:align-top [&_.ProseMirror_td]:whitespace-normal [&_.ProseMirror_.selectedCell]:bg-[#fff3f5]",
    "[&_.ProseMirror_.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror_.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_.is-editor-empty:first-child::before]:h-0 [&_.ProseMirror_.is-editor-empty:first-child::before]:text-slate-300 [&_.ProseMirror_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
  ]
    .filter(Boolean)
    .join(" ");
}

function useSelectionHighlightStyle() {
  useEffect(() => {
    const styleId = "aicp-tiptap-selection-highlight-style";
    if (!document.getElementById(styleId)) {
      const styleElement = document.createElement("style");
      styleElement.id = styleId;
      styleElement.textContent = `::highlight(${selectionHighlightName}) { background: rgba(255, 36, 66, 0.18); color: inherit; }`;
      document.head.appendChild(styleElement);
    }
    return () => clearSelectionHighlight();
  }, []);
}

export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(
  function RichTextEditor(
    {
      initialContent,
      resetKey,
      placeholder = "输入正文描述，真诚有价值的分享才入人心",
      onChange,
      onSelectionChange,
      onSaveShortcut,
      onOpenImageUpload,
    },
    ref
  ) {
    const [tableRows, setTableRows] = useState(3);
    const [tableCols, setTableCols] = useState(3);
    const [showTableMenu, setShowTableMenu] = useState(false);
    const lastResetKeyRef = useRef(resetKey);

    useSelectionHighlightStyle();

    const extensions = useMemo(
      () => [
        StarterKit,
        Image.configure({ inline: false, allowBase64: false }),
        TableKit.configure({ table: { resizable: true } }),
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        Placeholder.configure({ placeholder }),
      ],
      [placeholder]
    );

    const editor = useEditor({
      immediatelyRender: false,
      extensions,
      content: resolveInitialContent(initialContent),
      editorProps: {
        handleKeyDown: (_view, event) => {
          const mod = event.metaKey || event.ctrlKey;
          if (mod && event.key.toLowerCase() === "s") {
            event.preventDefault();
            onSaveShortcut?.();
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor: nextEditor }) => {
        onChange(editorValue(nextEditor));
      },
      onSelectionUpdate: ({ editor: nextEditor }) => {
        const { from, to } = nextEditor.state.selection;
        const text = nextEditor.state.doc.textBetween(from, to, "\n").trim();
        if (!text) {
          clearSelectionHighlight();
          onSelectionChange?.(null);
          return;
        }

        paintSelectionHighlight(nextEditor, from, to);
        const start = nextEditor.view.coordsAtPos(from);
        const end = nextEditor.view.coordsAtPos(to);
        onSelectionChange?.({
          text,
          top: Math.max(Math.min(start.top, end.top) - 48, 72),
          left: (start.left + end.right) / 2,
        });
      },
      onBlur: ({ editor: nextEditor }) => {
        const { from, to } = nextEditor.state.selection;
        if (from !== to) paintSelectionHighlight(nextEditor, from, to);
      },
    });

    useEffect(() => {
      if (!editor) return;
      if (lastResetKeyRef.current === resetKey) return;
      lastResetKeyRef.current = resetKey;
      editor.commands.setContent(resolveInitialContent(initialContent), { emitUpdate: false });
    }, [editor, initialContent, resetKey]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => editor?.commands.focus(),
        isFocused: () => editor?.isFocused ?? false,
        getValue: () => (editor ? editorValue(editor) : { text: "", html: "", json: { type: "doc", content: [] } }),
        getText: () => editor?.getText({ blockSeparator: "\n\n" }) ?? "",
        getHTML: () => editor?.getHTML() ?? "",
        getJSON: () => editor?.getJSON() ?? { type: "doc", content: [] },
        getSelectedText: () => {
          if (!editor) return "";
          const { from, to } = editor.state.selection;
          return editor.state.doc.textBetween(from, to, "\n").trim();
        },
        setContent: (content) => {
          editor?.commands.setContent(resolveInitialContent(content));
        },
        insertHTML: (html) => {
          editor?.chain().focus().insertContent(html).run();
        },
        insertText: (text) => {
          editor?.chain().focus().insertContent(text).run();
        },
        insertTextAtEnd: (text) => {
          editor?.chain().focus("end").insertContent(text).run();
        },
        insertImage: (src, alt) => {
          editor
            ?.chain()
            .focus()
            .insertContent([
              { type: "image", attrs: { src, alt } },
              { type: "paragraph" },
            ])
            .run();
        },
        replaceSelection: (text) => {
          editor?.chain().focus().insertContent(text).run();
          clearSelectionHighlight();
          onSelectionChange?.(null);
        },
        replaceTextRange: (input) => {
          if (!editor) return false;
          const changed = replaceTextRange(editor, input);
          if (changed) {
            clearSelectionHighlight();
            onSelectionChange?.(null);
          }
          return changed;
        },
        replaceTextRanges: (inputs) => {
          if (!editor) return 0;
          let changed = 0;
          const sorted = [...inputs].sort((left, right) => (right.startOffset ?? -1) - (left.startOffset ?? -1));
          for (const input of sorted) {
            if (replaceTextRange(editor, input)) changed += 1;
          }
          if (changed) {
            clearSelectionHighlight();
            onSelectionChange?.(null);
          }
          return changed;
        },
      }),
      [editor, onSelectionChange]
    );

    if (!editor) {
      return <div className="min-h-130 rounded-2xl bg-slate-50" />;
    }

    const insertTable = () => {
      const rows = Math.min(Math.max(tableRows, 1), 8);
      const cols = Math.min(Math.max(tableCols, 1), 8);
      editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
      setShowTableMenu(false);
    };

    return (
      <div>
        <div className="sticky top-0 z-20 -mx-5 mt-4 flex flex-wrap items-center gap-1 border-y border-slate-100 bg-white/95 px-5 py-3 backdrop-blur">
          <ToolbarButton label="段落" active={editor.isActive("paragraph")} onClick={() => editor.chain().focus().setParagraph().run()}>
            <Pilcrow size={17} />
          </ToolbarButton>
          <ToolbarButton label="一级标题" active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
            <Heading1 size={17} />
          </ToolbarButton>
          <ToolbarButton label="二级标题" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
            <Heading2 size={17} />
          </ToolbarButton>
          <ToolbarButton label="三级标题" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
            <Heading3 size={17} />
          </ToolbarButton>
          <Divider />
          <ToolbarButton label="加粗 Ctrl+B" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
            <Bold size={17} />
          </ToolbarButton>
          <ToolbarButton label="斜体 Ctrl+I" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <Italic size={17} />
          </ToolbarButton>
          <ToolbarButton label="代码" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>
            <Code2 size={17} />
          </ToolbarButton>
          <ToolbarButton
            label="链接"
            active={editor.isActive("link")}
            onClick={() => {
              const href = window.prompt("请输入链接地址");
              if (href) editor.chain().focus().setLink({ href }).run();
            }}
          >
            <Link2 size={17} />
          </ToolbarButton>
          <Divider />
          <ToolbarButton label="无序列表" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
            <List size={17} />
          </ToolbarButton>
          <ToolbarButton label="有序列表" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
            <ListOrdered size={17} />
          </ToolbarButton>
          <ToolbarButton label="引用" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
            <Quote size={17} />
          </ToolbarButton>
          <Divider />
          <ToolbarButton label="左对齐" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}>
            <AlignLeft size={17} />
          </ToolbarButton>
          <ToolbarButton label="居中" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}>
            <AlignCenter size={17} />
          </ToolbarButton>
          <ToolbarButton label="右对齐" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}>
            <AlignRight size={17} />
          </ToolbarButton>
          <ToolbarButton label="两端对齐" active={editor.isActive({ textAlign: "justify" })} onClick={() => editor.chain().focus().setTextAlign("justify").run()}>
            <AlignJustify size={17} />
          </ToolbarButton>
          <Divider />
          <div className="relative">
            <ToolbarButton label="插入表格" active={showTableMenu} onClick={() => setShowTableMenu((value) => !value)}>
              <Table2 size={17} />
            </ToolbarButton>
            {showTableMenu ? (
              <div className="absolute left-0 top-[calc(100%+8px)] z-30 w-56 rounded-2xl border border-slate-100 bg-white p-3 shadow-xl">
                <p className="mb-2 text-xs font-semibold text-slate-400">插入表格</p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs font-semibold text-slate-500">
                    行
                    <input value={tableRows} onChange={(event) => setTableRows(Number(event.target.value))} min={1} max={8} type="number" className="mt-1 w-full rounded-xl bg-slate-50 px-3 py-2 text-sm outline-none" />
                  </label>
                  <label className="text-xs font-semibold text-slate-500">
                    列
                    <input value={tableCols} onChange={(event) => setTableCols(Number(event.target.value))} min={1} max={8} type="number" className="mt-1 w-full rounded-xl bg-slate-50 px-3 py-2 text-sm outline-none" />
                  </label>
                </div>
                <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={insertTable} className="mt-3 w-full rounded-xl bg-[#ff2442] px-3 py-2 text-sm font-semibold text-white">
                  插入 {Math.min(Math.max(tableRows, 1), 8)} x {Math.min(Math.max(tableCols, 1), 8)}
                </button>
              </div>
            ) : null}
          </div>
          <ToolbarButton label="上传并插入图片" onClick={() => onOpenImageUpload?.()}>
            <ImagePlus size={17} />
          </ToolbarButton>
          <ToolbarButton label="撤回 Ctrl+Z" onClick={() => editor.chain().focus().undo().run()}>
            <Undo2 size={17} />
          </ToolbarButton>
          <ToolbarButton label="重做 Ctrl+Shift+Z" onClick={() => editor.chain().focus().redo().run()}>
            <Redo2 size={17} />
          </ToolbarButton>
          <ToolbarButton label="删除选中内容" onClick={() => editor.chain().focus().deleteSelection().run()}>
            <Trash2 size={17} />
          </ToolbarButton>
        </div>

        <EditorContent editor={editor} className={editorContentClassName()} />
      </div>
    );
  }
);

function ToolbarButton({
  label,
  active = false,
  children,
  onClick,
}: {
  label: string;
  active?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      title={label}
      className={`grid size-9 place-items-center rounded-xl transition ${
        active ? "bg-[#fff3f5] text-[#ff2442]" : "text-slate-600 hover:bg-[#fff3f5] hover:text-[#ff2442]"
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-6 w-px bg-slate-100" />;
}

export function RichTextRenderer({ content }: { content: RichTextInitialContent }) {
  const extensions = useMemo(
    () => [
      StarterKit,
      Image.configure({ inline: false, allowBase64: false }),
      TableKit.configure({ table: { resizable: false } }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    []
  );
  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    extensions,
    content: resolveInitialContent(content),
  });

  useEffect(() => {
    if (!editor) return;
    editor.commands.setContent(resolveInitialContent(content), { emitUpdate: false });
  }, [content, editor]);

  if (!editor) return null;
  return <EditorContent editor={editor} className={editorContentClassName(true)} />;
}
