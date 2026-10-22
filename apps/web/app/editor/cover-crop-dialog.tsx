"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  file: File;
  onCancel: () => void;
  onConfirm: (file: File) => void;
};

export function CoverCropDialog({ file, onCancel, onConfirm }: Props) {
  const [source, setSource] = useState("");
  const [focal, setFocal] = useState({ x: 0.5, y: 0.5 });
  const [error, setError] = useState("");
  const previewRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    focalX: number;
    focalY: number;
    overflowX: number;
    overflowY: number;
  } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSource(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    const frame = previewRef.current;
    const image = imageRef.current;
    if (!frame || !image?.naturalWidth || !image.naturalHeight) return;
    const rect = frame.getBoundingClientRect();
    const scale = Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      focalX: focal.x,
      focalY: focal.y,
      overflowX: Math.max(0, image.naturalWidth * scale - rect.width),
      overflowY: Math.max(0, image.naturalHeight * scale - rect.height),
    };
    frame.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function dragImage(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // CSS object-position grows as the image moves left/up, so invert the
    // pointer delta to make the image follow the author's hand.
    setFocal({
      x: drag.overflowX ? Math.max(0, Math.min(1, drag.focalX - (event.clientX - drag.startX) / drag.overflowX)) : 0.5,
      y: drag.overflowY ? Math.max(0, Math.min(1, drag.focalY - (event.clientY - drag.startY) / drag.overflowY)) : 0.5,
    });
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (previewRef.current?.hasPointerCapture(event.pointerId)) {
      previewRef.current.releasePointerCapture(event.pointerId);
    }
  }

  async function confirmCrop() {
    setError("");
    try {
    const image = new Image();
    image.src = source;
    await image.decode();
    const aspect = 3 / 2;
    let cropWidth = image.naturalWidth;
    let cropHeight = cropWidth / aspect;
    if (cropHeight > image.naturalHeight) {
      cropHeight = image.naturalHeight;
      cropWidth = cropHeight * aspect;
    }
    const x = focal.x * (image.naturalWidth - cropWidth);
    const y = focal.y * (image.naturalHeight - cropHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(1800, Math.round(cropWidth));
    canvas.height = Math.round(canvas.width / aspect);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法处理封面图片");
    context.drawImage(image, x, y, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("封面裁剪失败")), "image/webp", 0.9));
    const baseName = file.name.replace(/\.[^.]+$/, "") || "cover";
    onConfirm(new File([blob], `${baseName}-cover.webp`, { type: "image/webp", lastModified: Date.now() }));
    } catch (cropError) {
      setError(cropError instanceof Error ? cropError.message : "无法读取这张图片，请换一张再试");
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="cover-crop-title">
      <section className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl">
        <header className="mb-4 flex items-center justify-between">
          <h2 id="cover-crop-title" className="text-lg font-semibold text-slate-900">调整封面取景</h2>
          <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">取消</button>
        </header>
        <p className="mb-3 text-sm text-slate-500">拖动图片选择主体位置，保存后只上传裁剪后的封面。</p>
        <div
          ref={previewRef}
          className="relative aspect-[3/2] touch-none cursor-grab overflow-hidden rounded-xl bg-slate-100 active:cursor-grabbing"
          onPointerDown={startDrag}
          onPointerMove={dragImage}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={() => { dragRef.current = null; }}
        >
          {source ? <img ref={imageRef} src={source} alt="封面裁剪预览" draggable={false} className="size-full select-none object-cover" style={{ objectPosition: `${focal.x * 100}% ${focal.y * 100}%` }} /> : null}
          <div className="pointer-events-none absolute inset-0 border border-white/70" />
        </div>
        {error ? <p role="alert" className="mt-2 text-sm text-rose-600">{error}</p> : null}
        <footer className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-700">取消</button>
          <button type="button" onClick={() => void confirmCrop()} className="rounded-xl bg-[#ff2442] px-4 py-2 text-sm font-semibold text-white">使用此封面</button>
        </footer>
      </section>
    </div>
  );
}
