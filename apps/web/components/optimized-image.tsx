"use client";

import { useState, useEffect, useRef } from "react";

type OptimizedImageProps = {
  src: string;
  alt?: string;
  width?: number;
  height?: number;
  className?: string;
  style?: React.CSSProperties;
  priority?: boolean;
  onClick?: () => void;
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
}: OptimizedImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (imgRef.current?.complete) {
      setLoaded(true);
    }
  }, [src]);

  return (
    <div
      className={`relative overflow-hidden bg-slate-100 ${className}`}
      style={{
        width,
        aspectRatio: `${width} / ${height}`,
        ...style,
      }}
    >
      {!loaded && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50">
          <div className="h-5 w-5 animate-pulse rounded-full bg-slate-200" />
        </div>
      )}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        width={width}
        height={height}
        className={`h-full w-full object-cover transition-opacity duration-200 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "low"}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        onClick={onClick}
        draggable={false}
      />
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-100 text-slate-400">
          <span className="text-xs">图片加载失败</span>
        </div>
      )}
    </div>
  );
}
