import { ImageIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { useResolvedImageCandidates } from "@/hooks/useResolvedImageSources";
import { cn } from "@/lib/utils";

export interface ImageOptionCardProps {
  src: string;
  label: string;
  width?: number | null;
  height?: number | null;
  subtitle?: string;
  selected?: boolean;
  onClick?: () => void;
  loading?: boolean;
  empty?: boolean;
  emptyText?: string;
  imageContainerClassName?: string;
  stacked?: boolean;
  fallbackSrcs?: string[];
  sourceRows?: Array<{
    label: string;
    value: string;
  }>;
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
  subtitle,
  selected = false,
  onClick,
  loading = false,
  empty = false,
  emptyText = "暂无图片",
  imageContainerClassName,
  stacked = false,
  fallbackSrcs = [],
  sourceRows = [],
}: ImageOptionCardProps) {
  const [naturalSize, setNaturalSize] = useState<{ src: string; width: number; height: number } | null>(null);
  const [candidateIndex, setCandidateIndex] = useState(0);

  const rawCandidates = useMemo(() => {
    if (empty || !src.trim()) {
      return fallbackSrcs;
    }
    return [src, ...fallbackSrcs];
  }, [empty, fallbackSrcs, src]);
  const renderCandidates = useResolvedImageCandidates(rawCandidates);
  const firstRenderCandidate = renderCandidates[0] ?? "";

  useEffect(() => {
    const nextCandidates = new Set(renderCandidates);
    setCandidateIndex(0);
    setNaturalSize((current) =>
      current && current.src === firstRenderCandidate && nextCandidates.has(current.src) ? current : null,
    );
  }, [firstRenderCandidate, renderCandidates]);

  const renderSrc = renderCandidates[candidateIndex] ?? "";

  const measuredSize = naturalSize?.src === renderSrc ? naturalSize : null;
  const resolvedWidth = width ?? measuredSize?.width ?? null;
  const resolvedHeight = height ?? measuredSize?.height ?? null;
  const clickable = Boolean(onClick) && !loading && !empty;
  const isPortrait = Boolean(resolvedWidth && resolvedHeight && resolvedHeight > resolvedWidth);
  const stackedWidthClass = isPortrait ? "max-w-48" : "max-w-xl";
  const containerClassName = cn(
    "block w-full min-w-0 overflow-hidden rounded-xl bg-card p-4 text-left align-top transition-all duration-200",
    empty ? "border-2 border-dashed border-muted-foreground/25" : "border-2",
    selected ? "border-primary ring-2 ring-primary/20" : "border-transparent hover:border-muted-foreground/20",
    clickable && "cursor-pointer",
  );

  const content = (
    <div className={cn("flex min-w-0 gap-4", stacked ? "flex-col items-center" : "flex-col sm:flex-row")}>
      <div
        className={cn(
          "relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/20",
          stacked && "mx-auto",
          stacked
            ? isPortrait
              ? `h-64 w-full ${stackedWidthClass} sm:h-72`
              : `h-40 w-full ${stackedWidthClass}`
            : isPortrait
              ? "h-64 w-full sm:h-72 sm:w-48"
              : "h-40 w-full sm:w-48",
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
            className="block h-full w-full max-w-full object-contain object-center"
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
            onError={() => {
              setNaturalSize(null);
              setCandidateIndex((currentIndex) => {
                if (currentIndex < renderCandidates.length - 1) {
                  return currentIndex + 1;
                }
                return renderCandidates.length;
              });
            }}
          />
        )}
      </div>

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col justify-center gap-2",
          stacked && `mx-auto w-full ${stackedWidthClass}`,
        )}
      >
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
            {sourceRows.map((row) => (
              <div key={row.label} className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
                <span className="shrink-0">{row.label}:</span>
                <span className="min-w-0 truncate text-foreground/85" title={row.value}>
                  {row.value}
                </span>
              </div>
            ))}
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
