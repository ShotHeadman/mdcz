import { Badge, cn } from "@mdcz/ui";
import { ImageIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n";
import { NaturalAspectImageFrame } from "./NaturalAspectImageFrame";

export type ResolveImageOptionCandidates = (candidates: string[], baseDir?: string) => Promise<string[]>;

export interface ImageOptionCardProps {
  baseDir?: string;
  defaultAspectRatio?: number;
  empty?: boolean;
  emptyText?: string;
  fallbackSrcs?: string[];
  height?: number | null;
  imageFrameClassName?: string;
  label: string;
  layout?: "inline" | "stacked";
  loading?: boolean;
  metadataClassName?: string;
  onClick?: () => void;
  resolveImageCandidates?: ResolveImageOptionCandidates;
  selected?: boolean;
  showDimensions?: boolean;
  sourceRows?: Array<{
    label: string;
    value: string;
  }>;
  src: string;
  subtitle?: string;
  width?: number | null;
}

const dedupeValues = (values: string[]): string[] =>
  values
    .map((value) => value.trim())
    .filter((value, index, items) => value.length > 0 && items.indexOf(value) === index);

const defaultResolveImageCandidates: ResolveImageOptionCandidates = async (candidates) => dedupeValues(candidates);

const formatDimensions = (
  width: number | null | undefined,
  height: number | null | undefined,
  unknownLabel: string,
): string => {
  if (!width || !height) {
    return unknownLabel;
  }
  return `${width} x ${height}`;
};

const useResolvedImageOptionCandidates = (
  resolveImageCandidates: ResolveImageOptionCandidates,
  rawCandidates: string[],
  baseDir?: string,
): string[] => {
  const candidateKey = rawCandidates.map((candidate) => candidate.trim()).join("\u0000");
  const [resolved, setResolved] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const candidates = candidateKey ? candidateKey.split("\u0000").filter(Boolean) : [];

    const resolve = async () => {
      const next = await resolveImageCandidates(candidates, baseDir);
      if (!cancelled) {
        setResolved(next);
      }
    };

    void resolve();

    return () => {
      cancelled = true;
    };
  }, [baseDir, candidateKey, resolveImageCandidates]);

  return resolved;
};

export function ImageOptionCard({
  baseDir,
  defaultAspectRatio,
  empty = false,
  emptyText,
  fallbackSrcs = [],
  height,
  imageFrameClassName,
  label,
  layout = "stacked",
  loading = false,
  metadataClassName,
  onClick,
  resolveImageCandidates = defaultResolveImageCandidates,
  selected = false,
  showDimensions = false,
  sourceRows = [],
  src,
  subtitle,
  width,
}: ImageOptionCardProps) {
  const t = useT();
  const effectiveEmptyText = emptyText ?? t.media.imageOption.emptyText;
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [measuredSize, setMeasuredSize] = useState<{ height: number; src: string; width: number } | null>(null);
  const rawCandidates = useMemo(() => {
    const raw = empty || !src.trim() ? fallbackSrcs : [src, ...fallbackSrcs];
    return dedupeValues(raw);
  }, [empty, fallbackSrcs, src]);
  const candidates = useResolvedImageOptionCandidates(resolveImageCandidates, rawCandidates, baseDir);
  const firstCandidate = candidates[0] ?? "";
  const previousFirstCandidateRef = useRef(firstCandidate);
  const renderSrc = candidates[candidateIndex] ?? "";
  const resolvedWidth = width ?? (measuredSize?.src === renderSrc ? measuredSize.width : null);
  const resolvedHeight = height ?? (measuredSize?.src === renderSrc ? measuredSize.height : null);
  const clickable = Boolean(onClick) && !loading && !empty;

  useEffect(() => {
    if (previousFirstCandidateRef.current === firstCandidate) {
      return;
    }
    previousFirstCandidateRef.current = firstCandidate;
    setCandidateIndex(0);
    setMeasuredSize(null);
  }, [firstCandidate]);

  const content = (
    <div className={cn("flex min-w-0 gap-4", layout === "inline" ? "flex-col sm:flex-row" : "flex-col items-center")}>
      <NaturalAspectImageFrame
        src={renderSrc}
        alt={label}
        width={width}
        height={height}
        loading={loading}
        empty={empty || !renderSrc}
        defaultAspectRatio={defaultAspectRatio}
        className={cn("mx-auto rounded-lg bg-muted/20", imageFrameClassName)}
        emptyNode={
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <ImageIcon className="h-8 w-8 opacity-40" />
            <span className="text-xs">{effectiveEmptyText}</span>
          </div>
        }
        onError={() => {
          setMeasuredSize(null);
          setCandidateIndex((currentIndex) =>
            currentIndex < candidates.length - 1 ? currentIndex + 1 : candidates.length,
          );
        }}
        onLoadDimensions={({ height: naturalHeight, width: naturalWidth }) => {
          setMeasuredSize({ height: naturalHeight, src: renderSrc, width: naturalWidth });
        }}
      />
      <div
        className={cn(
          "flex w-full min-w-0 flex-col justify-center gap-2",
          layout === "stacked" && "mx-auto",
          metadataClassName,
        )}
      >
        {loading ? (
          <>
            <div className="h-5 w-24 animate-pulse rounded-full bg-muted/40" />
            <div className="h-4 w-32 animate-pulse rounded bg-muted/40" />
            <div className="h-4 w-full animate-pulse rounded bg-muted/40" />
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Badge variant={selected ? "default" : "secondary"}>{label}</Badge>
            </div>
            {showDimensions ? (
              <div className="text-sm text-foreground wrap-anywhere">
                <span className="text-muted-foreground">{t.media.imageOption.dimensions}</span>
                <span>{formatDimensions(resolvedWidth, resolvedHeight, t.media.imageOption.unknown)}</span>
              </div>
            ) : null}
            {sourceRows.map((row) => (
              <div key={row.label} className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
                <span className="shrink-0">{row.label}:</span>
                <span className="min-w-0 truncate text-foreground/85" title={row.value}>
                  {row.value}
                </span>
              </div>
            ))}
            {subtitle ? <div className="text-sm text-muted-foreground wrap-anywhere">{subtitle}</div> : null}
          </>
        )}
      </div>
    </div>
  );
  const className = cn(
    "block w-full min-w-0 overflow-hidden rounded-xl bg-card p-4 text-left align-top transition-all duration-200",
    empty ? "border-2 border-dashed border-muted-foreground/25" : "border-2",
    selected ? "border-primary ring-2 ring-primary/20" : "border-transparent hover:border-muted-foreground/20",
    clickable && "cursor-pointer",
  );

  if (clickable) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}
