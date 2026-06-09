"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AssetSummary } from "@aicp/shared";
import { FileText, Image as ImageIcon, Loader2, ShieldCheck, Trash2, UploadCloud, X } from "lucide-react";
import { deleteAsset, getAssets, uploadAsset } from "../../lib/api";

type AssetFilter = "all" | "image" | "text";

const filters: Array<{ key: AssetFilter; label: string }> = [
  { key: "all", label: "全部素材" },
  { key: "image", label: "图片素材" },
  { key: "text", label: "文本素材" },
];

const statusLabel: Record<AssetSummary["auditStatus"], string> = {
  approved: "合规通过",
  pending: "待校验",
  rejected: "未通过",
};

const statusClass: Record<AssetSummary["auditStatus"], string> = {
  approved: "bg-emerald-50 text-emerald-700",
  pending: "bg-amber-50 text-amber-700",
  rejected: "bg-rose-50 text-rose-700",
};

const riskLevelLabel: Record<NonNullable<AssetSummary["riskLevel"]>, string> = {
  unknown: "风险待判定",
  low: "低风险",
  medium: "中风险",
  high: "高风险",
};

export default function AnalyticsPage() {
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [filter, setFilter] = useState<AssetFilter>("all");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [previewAsset, setPreviewAsset] = useState<AssetSummary | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const items = await getAssets();
        if (!cancelled) setAssets(items);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "素材加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredAssets = useMemo(() => {
    if (filter === "image") return assets.filter((item) => item.mimeType.startsWith("image/"));
    if (filter === "text") return assets.filter((item) => item.mimeType.startsWith("text/"));
    return assets;
  }, [assets, filter]);

  const counts = useMemo(
    () => ({
      all: assets.length,
      image: assets.filter((item) => item.mimeType.startsWith("image/")).length,
      text: assets.filter((item) => item.mimeType.startsWith("text/")).length,
      rejected: assets.filter((item) => item.auditStatus === "rejected").length,
    }),
    [assets]
  );

  async function handleUpload(file?: File) {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const asset = await uploadAsset({ file });
      setAssets((current) => [asset, ...current]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    setError("");
    try {
      await deleteAsset(id);
      setAssets((current) => current.filter((item) => item.id !== id));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除失败");
    }
  }

  return (
    <div className="mx-auto w-full max-w-350 px-4 py-5 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="m-0 text-2xl font-black text-slate-950">素材管理</h1>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(event) => void handleUpload(event.target.files?.[0])}
          />
          <input
            ref={textInputRef}
            type="file"
            accept="text/plain,text/markdown,.txt,.md"
            className="hidden"
            onChange={(event) => void handleUpload(event.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:border-rose-200 hover:text-rose-600"
          >
            <ImageIcon className="h-4 w-4" />
            上传图片
          </button>
          <button
            type="button"
            onClick={() => textInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-full bg-[#ff2442] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#e6352b]"
          >
            <FileText className="h-4 w-4" />
            上传文本
          </button>
        </div>
      </div>

      <section className="mb-5 grid gap-3 md:grid-cols-4">
        <SummaryCard label="全部素材" value={counts.all} />
        <SummaryCard label="图片素材" value={counts.image} />
        <SummaryCard label="文本素材" value={counts.text} />
        <SummaryCard label="需处理素材" value={counts.rejected} accent />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex flex-wrap gap-2">
            {filters.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                className={`rounded-full px-4 py-2 text-sm font-bold transition ${
                  filter === item.key ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="inline-flex items-center gap-2 text-xs font-bold text-slate-400">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {uploading ? "正在上传并校验" : "基础合规校验已启用"}
          </div>
        </div>

        {error ? <div className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">{error}</div> : null}

        {loading ? (
          <div className="mt-6 flex h-60 items-center justify-center gap-3 text-sm font-bold text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            正在加载素材...
          </div>
        ) : filteredAssets.length === 0 ? (
          <div className="mt-6 grid h-64 place-items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-center">
            <div>
              <UploadCloud className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 text-sm font-bold text-slate-600">还没有匹配的素材</p>
              <p className="mt-1 text-xs text-slate-400">上传图片或文本后，会在这里显示审核状态和预览。</p>
            </div>
          </div>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredAssets.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                onPreview={() => setPreviewAsset(asset)}
                onDelete={() => void handleDelete(asset.id)}
              />
            ))}
          </div>
        )}
      </section>

      {previewAsset ? <AssetPreviewModal asset={previewAsset} onClose={() => setPreviewAsset(null)} /> : null}
    </div>
  );
}

function SummaryCard({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-bold text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-black ${accent ? "text-rose-600" : "text-slate-950"}`}>{value}</p>
    </div>
  );
}

function AssetCard({ asset, onPreview, onDelete }: { asset: AssetSummary; onPreview: () => void; onDelete: () => void }) {
  const isImage = asset.mimeType.startsWith("image/");
  const previewText =
    typeof asset.metadata?.previewText === "string"
      ? asset.metadata.previewText
      : typeof asset.metadata?.preview === "string"
        ? asset.metadata.preview
        : "";

  return (
    <article
      className="cursor-pointer overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
      role="button"
      tabIndex={0}
      onClick={onPreview}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onPreview();
      }}
    >
      <div className="aspect-4/3 bg-slate-100">
        {isImage ? (
          <img src={asset.url} alt={asset.fileName} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full flex-col gap-3 p-5">
            <FileText className="h-8 w-8 text-slate-300" />
            <p className="line-clamp-6 whitespace-pre-wrap text-sm leading-6 text-slate-600">{previewText || "文本素材预览暂不可用"}</p>
          </div>
        )}
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-black text-slate-950">{asset.fileName}</h3>
            <p className="mt-1 text-xs font-semibold text-slate-400">{asset.mimeType}</p>
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            className="grid size-8 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
            title="删除素材"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-black ${statusClass[asset.auditStatus]}`}>
            {statusLabel[asset.auditStatus]}
          </span>
          {asset.riskLevel ? (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-500">
              {riskLevelLabel[asset.riskLevel] ?? asset.riskLevel}
            </span>
          ) : null}
          {asset.createdAt ? <span className="text-xs font-semibold text-slate-400">{new Date(asset.createdAt).toLocaleDateString()}</span> : null}
        </div>
        {asset.riskTypes?.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {asset.riskTypes.slice(0, 3).map((type) => (
              <span key={type} className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-600">
                {type}
              </span>
            ))}
          </div>
        ) : null}
        {asset.auditReason ? <p className="mt-3 line-clamp-2 text-xs leading-5 text-rose-500">{asset.auditReason}</p> : null}
      </div>
    </article>
  );
}

function AssetPreviewModal({ asset, onClose }: { asset: AssetSummary; onClose: () => void }) {
  const isImage = asset.mimeType.startsWith("image/");
  const initialText =
    typeof asset.metadata?.previewText === "string"
      ? asset.metadata.previewText
      : typeof asset.metadata?.preview === "string"
        ? asset.metadata.preview
        : "";
  const [text, setText] = useState(initialText);
  const [loadingText, setLoadingText] = useState(false);
  const [textError, setTextError] = useState("");

  useEffect(() => {
    if (isImage || initialText) return;
    let cancelled = false;
    async function loadText() {
      setLoadingText(true);
      setTextError("");
      try {
        const response = await fetch(asset.url);
        if (!response.ok) throw new Error(`读取失败：${response.status}`);
        const body = await response.text();
        if (!cancelled) setText(body);
      } catch (error) {
        if (!cancelled) setTextError(error instanceof Error ? error.message : "文本读取失败");
      } finally {
        if (!cancelled) setLoadingText(false);
      }
    }
    void loadText();
    return () => {
      cancelled = true;
    };
  }, [asset.url, initialText, isImage]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-black text-slate-950">{asset.fileName}</h2>
            <p className="mt-1 text-xs font-semibold text-slate-400">{asset.mimeType}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200"
            title="关闭预览"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[64vh] overflow-auto bg-slate-50 p-5">
          {isImage ? (
            <img src={asset.url} alt={asset.fileName} className="mx-auto max-h-[58vh] max-w-full rounded-2xl object-contain shadow-sm" />
          ) : loadingText ? (
            <div className="grid h-60 place-items-center text-sm font-bold text-slate-400">
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在读取文本素材...
              </span>
            </div>
          ) : textError ? (
            <div className="rounded-2xl bg-rose-50 p-5 text-sm font-semibold text-rose-600">{textError}</div>
          ) : (
            <pre className="whitespace-pre-wrap rounded-2xl bg-white p-5 text-sm leading-7 text-slate-700 shadow-sm">
              {text || "文本素材预览暂不可用"}
            </pre>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-4">
          <span className={`rounded-full px-2.5 py-1 text-xs font-black ${statusClass[asset.auditStatus]}`}>
            {statusLabel[asset.auditStatus]}
          </span>
          {asset.riskLevel ? (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-500">
              {riskLevelLabel[asset.riskLevel] ?? asset.riskLevel}
            </span>
          ) : null}
          {asset.riskTypes?.map((type) => (
            <span key={type} className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-black text-rose-600">
              {type}
            </span>
          ))}
          {asset.auditReason ? <span className="text-xs font-semibold text-rose-500">{asset.auditReason}</span> : null}
        </div>
      </div>
    </div>
  );
}
