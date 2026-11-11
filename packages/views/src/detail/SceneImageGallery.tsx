import { cn, Dialog, DialogContent, DialogDescription, DialogTitle } from "@mdcz/ui";
import { ChevronLeft, ChevronRight, ImageIcon, Play, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useT } from "../i18n";
import { TrailerPlayer } from "./TrailerPlayer";

export type ResolveImageCandidates = (candidates: string[], baseDir?: string) => Promise<string[]>;

interface SceneImageGalleryProps {
  images: string[];
  trailerSrc?: string;
  baseDir?: string;
  /** Small tiles for side-by-side comparisons. */
  compact?: boolean;
  resolveImageCandidates: ResolveImageCandidates;
  onTrailerError?: () => void;
}

const MAX_THUMBNAILS = 10;
const STYLES = {
  filmstrip: {
    strip: "gap-4 pb-4",
    tile: "h-[136px] w-[240px] rounded-quiet transition-transform hover:-translate-y-0.5",
    image:
      "border border-black/5 bg-surface-low/55 shadow-[0_10px_24px_rgba(0,0,0,0.06)] hover:shadow-[0_16px_32px_rgba(0,0,0,0.08)]",
    more: "border border-dashed border-black/10 bg-surface-low/45 text-sm font-semibold text-foreground/70 hover:bg-surface-low/60",
  },
  compact: {
    strip: "gap-1.5 p-1 scrollbar-thin",
    tile: "h-14 w-20 rounded-md",
    image: "border bg-muted/20 transition-shadow hover:ring-2 hover:ring-primary/50",
    more: "border bg-muted/30 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50",
  },
};

type Slide = { kind: "trailer"; autoPlay: boolean } | { kind: "image"; index: number };

const useResolvedImageSrc = (
  resolveImageCandidates: ResolveImageCandidates,
  rawCandidates: string[],
  baseDir?: string,
): string => {
  const candidateKey = rawCandidates.map((candidate) => candidate.trim()).join("\u0000");
  const [resolvedSrc, setResolvedSrc] = useState("");

  useEffect(() => {
    let cancelled = false;
    const candidates = candidateKey ? candidateKey.split("\u0000").filter(Boolean) : [];

    const resolve = async () => {
      const [nextSrc = ""] = await resolveImageCandidates(candidates, baseDir);
      if (!cancelled) {
        setResolvedSrc(nextSrc);
      }
    };

    void resolve();

    return () => {
      cancelled = true;
    };
  }, [baseDir, candidateKey, resolveImageCandidates]);

  return resolvedSrc;
};

export function SceneImageGallery({
  images,
  trailerSrc,
  baseDir,
  compact = false,
  resolveImageCandidates,
  onTrailerError,
}: SceneImageGalleryProps) {
  const t = useT();
  const [slide, setSlide] = useState<Slide | null>(null);
  const styles = STYLES[compact ? "compact" : "filmstrip"];
  const trailerSlots = trailerSrc ? 1 : 0;
  const total = images.length + trailerSlots;
  const isOpen = slide !== null && (slide.kind === "image" || Boolean(trailerSrc));
  const remainingCount = images.length - MAX_THUMBNAILS;

  const step = useCallback(
    (direction: 1 | -1) =>
      setSlide((current) => {
        if (!current) return current;
        const position = current.kind === "trailer" ? 0 : current.index + trailerSlots;
        const next = (position + direction + total) % total;
        return next < trailerSlots
          ? { kind: "trailer", autoPlay: false }
          : { kind: "image", index: next - trailerSlots };
      }),
    [total, trailerSlots],
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLVideoElement) return;

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        step(event.key === "ArrowLeft" ? -1 : 1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, step]);

  if (total === 0) {
    return null;
  }

  return (
    <div>
      <div className={cn("flex overflow-x-auto", styles.strip)}>
        {trailerSrc ? (
          <button
            type="button"
            aria-label={t.detail.playTrailer}
            onClick={() => setSlide({ kind: "trailer", autoPlay: true })}
            className={cn(
              "group relative flex shrink-0 items-end overflow-hidden bg-gradient-to-br from-neutral-800 via-neutral-900 to-black p-3 text-white shadow-[0_10px_24px_rgba(0,0,0,0.12)]",
              styles.tile,
            )}
          >
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25 transition-colors group-hover:bg-white/25">
                <Play className="ml-0.5 h-5 w-5 fill-white" />
              </span>
            </span>
            <span className="relative text-sm font-semibold">{t.detail.sections.trailer}</span>
          </button>
        ) : null}
        {images.slice(0, MAX_THUMBNAILS).map((imagePath, index) => (
          <button
            key={imagePath}
            type="button"
            onClick={() => setSlide({ kind: "image", index })}
            className={cn("relative shrink-0 overflow-hidden", styles.tile, styles.image)}
          >
            <LazyImage
              alt={`Scene ${index + 1}`}
              baseDir={baseDir}
              resolveImageCandidates={resolveImageCandidates}
              src={imagePath}
            />
          </button>
        ))}
        {remainingCount > 0 ? (
          <button
            type="button"
            onClick={() => setSlide({ kind: "image", index: MAX_THUMBNAILS })}
            className={cn("flex shrink-0 items-center justify-center overflow-hidden", styles.tile, styles.more)}
          >
            +{remainingCount}
          </button>
        ) : null}
      </div>

      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            setSlide(null);
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="flex w-fit max-w-none items-center justify-center gap-0 overflow-visible border-0 bg-transparent p-0 shadow-none backdrop-blur-none sm:max-w-none"
        >
          <DialogTitle className="sr-only">{t.detail.galleryTitle}</DialogTitle>
          <DialogDescription className="sr-only">
            {slide?.kind === "image"
              ? t.detail.galleryDescription(slide.index + 1, images.length)
              : images.length > 0
                ? t.detail.trailerSlideDescription
                : t.detail.sections.trailer}
          </DialogDescription>

          <button
            type="button"
            onClick={() => setSlide(null)}
            aria-label={t.detail.closePreview}
            className="absolute top-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="absolute top-3 left-3 z-10 rounded bg-black/60 px-2 py-0.5 font-mono text-sm text-white/80">
            {slide?.kind === "image" ? `${slide.index + 1} / ${images.length}` : t.detail.sections.trailer}
          </div>

          {total > 1 ? (
            <>
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label={t.detail.previousPhoto}
                className="absolute top-1/2 left-2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label={t.detail.nextPhoto}
                className="absolute top-1/2 right-2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          ) : null}

          <div className="flex max-h-[82vh] max-w-[90vw] items-center justify-center">
            {slide?.kind === "image" ? (
              <LightboxImage
                baseDir={baseDir}
                index={slide.index}
                resolveImageCandidates={resolveImageCandidates}
                src={images[slide.index]}
              />
            ) : slide && trailerSrc ? (
              <TrailerPlayer
                src={trailerSrc}
                autoPlay={slide.autoPlay}
                onError={onTrailerError}
                className="w-[min(90vw,1280px,calc(82vh*16/9))]"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LightboxImage({
  src,
  index,
  baseDir,
  resolveImageCandidates,
}: {
  src: string;
  index: number;
  baseDir?: string;
  resolveImageCandidates: ResolveImageCandidates;
}) {
  const resolvedSrc = useResolvedImageSrc(resolveImageCandidates, [src], baseDir);

  if (!resolvedSrc) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <ImageIcon className="h-8 w-8 text-white/25" />
      </div>
    );
  }

  return (
    <img src={resolvedSrc} alt={`Scene ${index + 1}`} className="block max-h-[82vh] max-w-[90vw] object-contain" />
  );
}

function LazyImage({
  src,
  alt,
  baseDir,
  resolveImageCandidates,
}: {
  src: string;
  alt: string;
  baseDir?: string;
  resolveImageCandidates: ResolveImageCandidates;
}) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const resolvedSrc = useResolvedImageSrc(resolveImageCandidates, [src], baseDir);

  useEffect(() => {
    setLoaded(false);
    setError(false);

    if (!resolvedSrc) {
      return;
    }

    let cancelled = false;
    const probe = new Image();
    probe.onload = () => {
      if (!cancelled) {
        setLoaded(true);
      }
    };
    probe.onerror = () => {
      if (!cancelled) {
        setError(true);
      }
    };
    probe.src = resolvedSrc;

    if (probe.complete) {
      if (probe.naturalWidth > 0 && probe.naturalHeight > 0) {
        setLoaded(true);
      } else {
        setError(true);
      }
    }

    return () => {
      cancelled = true;
      probe.onload = null;
      probe.onerror = null;
    };
  }, [resolvedSrc]);

  if (error || !resolvedSrc) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <ImageIcon className="h-4 w-4 text-muted-foreground/30" />
      </div>
    );
  }

  return (
    <>
      {!loaded ? <div className="h-full w-full animate-pulse bg-muted/30" /> : null}
      <img
        key={resolvedSrc}
        src={resolvedSrc}
        alt={alt}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        className={cn("h-full w-full object-cover", !loaded && "invisible")}
      />
    </>
  );
}
