import { ImageIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { getImageSrc } from "@/utils/image";

export interface ImageOptionCardProps {
  src: string;
  label: string;
  width?: number | null;
  height?: number | null;
  fileSize?: number | null;
  subtitle?: string;
  selected?: boolean;
  onClick?: () => void;
  loading?: boolean;
  empty?: boolean;
  emptyText?: string;
  imageContainerClassName?: string;
  stacked?: boolean;
}

function formatBytes(bytes: number | null | undefined): string {
  if (!Number.isFinite(bytes) || !bytes || bytes <= 0) {
    return "未知";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDimensions(width: number | null | undefined, height: number | null | undefined): string {
  if (!width || !height) {
    return "未知";
  }
  return `${width} × ${height}`;
}

export function ImageOptionCard({
  src,
  label,
  width,
  height,
  fileSize,
  subtitle,
  selected = false,
  onClick,
  loading = false,
  empty = false,
  emptyText = "暂无图片",
  imageContainerClassName,
  stacked = false,
}: ImageOptionCardProps) {
  const [naturalSize, setNaturalSize] = useState<{ src: string; width: number; height: number } | null>(null);

  const renderSrc = useMemo(() => {
    if (empty || !src.trim()) {
      return "";
    }
    return getImageSrc(src);
  }, [empty, src]);

  const measuredSize = naturalSize?.src === renderSrc ? naturalSize : null;
  const resolvedWidth = width ?? measuredSize?.width ?? null;
  const resolvedHeight = height ?? measuredSize?.height ?? null;
  const clickable = Boolean(onClick) && !loading && !empty;
  const isPortrait = Boolean(resolvedWidth && resolvedHeight && resolvedHeight > resolvedWidth);
  const containerClassName = cn(
    "block w-full min-w-0 overflow-hidden rounded-xl bg-card p-4 text-left align-top transition-all duration-200",
    empty ? "border-2 border-dashed border-muted-foreground/25" : "border-2",
    selected ? "border-primary ring-2 ring-primary/20" : "border-transparent hover:border-muted-foreground/20",
    clickable && "cursor-pointer",
  );

  const content = (
    <div className={cn("flex min-w-0 gap-4", stacked ? "flex-col" : "flex-col sm:flex-row")}>
      <div
        className={cn(
          "relative w-full shrink-0 overflow-hidden rounded-lg bg-muted/20",
          isPortrait ? "h-64 sm:h-72 sm:w-48" : "h-40 sm:h-40 sm:w-48",
          imageContainerClassName,
        )}
      >
        {loading ? (
          <div className="h-full w-full animate-pulse bg-muted/40" />
        ) : empty || !renderSrc ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <ImageIcon className="h-8 w-8 opacity-40" />
            <span className="text-xs">{emptyText}</span>
          </div>
        ) : (
          <img
            src={renderSrc}
            alt={label}
            className="block h-full w-full max-w-full object-contain"
            onLoad={(event) => {
              const image = event.currentTarget;
              if (image.naturalWidth > 0 && image.naturalHeight > 0) {
                setNaturalSize({
                  src: renderSrc,
                  width: image.naturalWidth,
                  height: image.naturalHeight,
                });
              }
            }}
          />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
        {loading ? (
          <>
            <div className="h-5 w-24 animate-pulse rounded-full bg-muted/40" />
            <div className="h-4 w-32 animate-pulse rounded bg-muted/40" />
            <div className="h-4 w-28 animate-pulse rounded bg-muted/40" />
            <div className="h-4 w-full animate-pulse rounded bg-muted/40" />
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Badge variant={selected ? "default" : "secondary"}>{label}</Badge>
            </div>
            <div className="text-sm text-foreground wrap-anywhere">
              <span className="text-muted-foreground">尺寸: </span>
              <span>{formatDimensions(resolvedWidth, resolvedHeight)}</span>
            </div>
            <div className="text-sm text-foreground wrap-anywhere">
              <span className="text-muted-foreground">大小: </span>
              <span>{formatBytes(fileSize)}</span>
            </div>
            {subtitle && <div className="text-sm text-muted-foreground wrap-anywhere">{subtitle}</div>}
          </>
        )}
      </div>
    </div>
  );

  if (clickable) {
    return (
      <button type="button" onClick={onClick} className={containerClassName}>
        {content}
      </button>
    );
  }

  return <div className={containerClassName}>{content}</div>;
}
