import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@mdcz/ui";
import { ChevronLeft, ChevronRight, ImageIcon, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useT } from "../i18n";

export type ResolveImageCandidates = (candidates: string[], baseDir?: string) => Promise<string[]>;

interface SceneImageGalleryProps {
  images: string[];
  maxThumbnails?: number;
  baseDir?: string;
  label?: string;
  variant?: "compact" | "filmstrip";
  resolveImageCandidates: ResolveImageCandidates;
}

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
  maxThumbnails = 10,
  baseDir,
  label,
  variant = "compact",
  resolveImageCandidates,
}: SceneImageGalleryProps) {
  const t = useT();
  const effectiveLabel = label ?? t.detail.preview;
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const isOpen = lightboxIndex >= 0;

  const visibleThumbnails = images.slice(0, maxThumbnails);
  const remainingCount = images.length - maxThumbnails;
  const isFilmstrip = variant === "filmstrip";

  const openLightbox = (index: number) => setLightboxIndex(index);
  const closeLightbox = useCallback(() => setLightboxIndex(-1), []);

  const goPrev = useCallback(() => {
    setLightboxIndex((index) => (index > 0 ? index - 1 : images.length - 1));
  }, [images.length]);

  const goNext = useCallback(() => {
    setLightboxIndex((index) => (index < images.length - 1 ? index + 1 : 0));
  }, [images.length]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrev();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeLightbox();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, goPrev, goNext, closeLightbox]);

  if (images.length === 0) {
    return null;
  }

  return (
    <div>
      <div
        className={
          isFilmstrip
            ? "mb-4 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground/80"
            : "mb-2 text-xs text-muted-foreground"
        }
      >
        {effectiveLabel}
        {!isFilmstrip ? ` (${images.length})` : ""}
      </div>

      <div
        className={isFilmstrip ? "flex gap-4 overflow-x-auto pb-4" : "flex gap-1.5 overflow-x-auto p-1 scrollbar-thin"}
      >
        {visibleThumbnails.map((imagePath, index) => (
          <button
            key={imagePath}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openLightbox(index);
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
            }}
            className={
              isFilmstrip
                ? "relative h-[136px] w-[240px] shrink-0 overflow-hidden rounded-quiet border border-black/5 bg-surface-low/55 shadow-[0_10px_24px_rgba(0,0,0,0.06)] transition-transform hover:-translate-y-0.5 hover:shadow-[0_16px_32px_rgba(0,0,0,0.08)]"
                : "h-14 w-20 shrink-0 cursor-pointer rounded-md border bg-muted/20 transition-all hover:ring-2 hover:ring-primary/50"
            }
          >
            <LazyImage
              alt={`Scene ${index + 1}`}
              baseDir={baseDir}
              resolveImageCandidates={resolveImageCandidates}
              src={imagePath}
              variant={variant}
            />
          </button>
        ))}
        {remainingCount > 0 ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openLightbox(maxThumbnails);
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
            }}
            className={
              isFilmstrip
                ? "flex h-[136px] w-[240px] shrink-0 items-center justify-center overflow-hidden rounded-quiet border border-dashed border-black/10 bg-surface-low/45 text-muted-foreground transition-colors hover:bg-surface-low/60"
                : "flex h-14 w-20 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md border bg-muted/30 transition-colors hover:bg-muted/50"
            }
          >
            <span
              className={
                isFilmstrip ? "text-sm font-semibold text-foreground/70" : "text-xs font-medium text-muted-foreground"
              }
            >
              +{remainingCount}
            </span>
          </button>
        ) : null}
      </div>

      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeLightbox();
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="flex w-fit max-w-none items-center justify-center gap-0 overflow-visible border-0 bg-transparent p-0 shadow-none backdrop-blur-none sm:max-w-none"
        >
          <DialogTitle className="sr-only">{t.detail.galleryTitle}</DialogTitle>
          <DialogDescription className="sr-only">
            {t.detail.galleryDescription(lightboxIndex + 1, images.length)}
          </DialogDescription>

          <button
            type="button"
            onClick={closeLightbox}
            aria-label={t.detail.closePreview}
            className="absolute top-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="absolute top-3 left-3 z-10 rounded bg-black/60 px-2 py-0.5 font-mono text-sm text-white/80">
            {lightboxIndex + 1} / {images.length}
          </div>

          {images.length > 1 ? (
            <>
              <button
                type="button"
                onClick={goPrev}
                aria-label={t.detail.previousPhoto}
                className="absolute top-1/2 left-2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={goNext}
                aria-label={t.detail.nextPhoto}
                className="absolute top-1/2 right-2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          ) : null}

          <div className="flex max-h-[82vh] max-w-[90vw] items-center justify-center">
            {lightboxIndex >= 0 && lightboxIndex < images.length ? (
              <LightboxImage
                baseDir={baseDir}
                index={lightboxIndex}
                resolveImageCandidates={resolveImageCandidates}
                src={images[lightboxIndex]}
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
  variant,
  resolveImageCandidates,
}: {
  src: string;
  alt: string;
  baseDir?: string;
  variant: "compact" | "filmstrip";
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
    <div
      className={
        variant === "filmstrip"
          ? "h-full w-full overflow-hidden rounded-quiet"
          : "h-full w-full overflow-hidden rounded-md"
      }
    >
      {!loaded ? <div className="h-full w-full animate-pulse bg-muted/30" /> : null}
      <img
        key={resolvedSrc}
        src={resolvedSrc}
        alt={alt}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        className={`h-full w-full object-cover ${loaded ? "" : "invisible"}`}
      />
    </div>
  );
}
