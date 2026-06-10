"use client";

import { useEffect, useRef, useState } from "react";
import NextImage from "next/image";

type OptimizedImageProps = {
  src: string;
  alt?: string;
  width?: number;
  height?: number;
  className?: string;
  style?: React.CSSProperties;
  priority?: boolean;
  onClick?: () => void;
  fill?: boolean;
};

export function OptimizedImage({
  src,
  alt = "",
  width = 400,
  height = 300,
  className = "",
  style = {},
  priority = false,
  onClick,
  fill = false,
}: OptimizedImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [useRawFallback, setUseRawFallback] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const normalizedSrc = normalizeImageSrc(src);

  useEffect(() => {
    setLoaded(false);
    setError(false);
    setUseRawFallback(false);
    if (imgRef.current?.complete) {
      setLoaded(true);
    }
  }, [normalizedSrc]);

  const shouldBypassOptimizer = normalizedSrc.startsWith("blob:") || normalizedSrc.startsWith("data:");
  const canFallbackToRawImage = /\/api\/uploads\//.test(normalizedSrc);
  const imageClassName = `h-full w-full object-cover transition-opacity duration-300 ${
    loaded ? "opacity-100" : "opacity-0"
  }`;

  return (
    <div
      className={`relative overflow-hidden bg-slate-100 ${className}`}
      style={{
        ...(fill ? { inset: 0 } : { aspectRatio: `${width} / ${height}`, width }),
        ...style,
      }}
    >
      {!loaded && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50">
          <div className="h-5 w-5 animate-pulse rounded-full bg-slate-200" />
        </div>
      )}
      {useRawFallback ? (
        <img
          ref={imgRef}
          src={normalizedSrc}
          alt={alt}
          className={imageClassName}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          onClick={onClick}
          draggable={false}
        />
      ) : (
        <NextImage
          ref={imgRef as any}
          src={normalizedSrc}
          alt={alt}
          width={fill ? undefined : width}
          height={fill ? undefined : height}
          fill={fill}
          className={imageClassName}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          onLoadingComplete={() => setLoaded(true)}
          onError={() => {
            if (canFallbackToRawImage) {
              setUseRawFallback(true);
              return;
            }
            setError(true);
          }}
          onClick={onClick}
          draggable={false}
          unoptimized={shouldBypassOptimizer}
        />
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-100 text-slate-400">
          <span className="text-xs">图片加载失败</span>
        </div>
      )}
    </div>
  );
}

function normalizeImageSrc(src: string) {
  try {
    const url = new URL(src);
    if (url.pathname.startsWith("/api/uploads/")) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
  }

  return src;
}
