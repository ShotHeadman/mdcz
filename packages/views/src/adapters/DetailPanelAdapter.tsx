import { toErrorMessage } from "@mdcz/shared/error";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import { findScrapeResultGroup } from "@mdcz/shared/viewModels/scrapeResultGrouping";
import { selectScrapeResults, useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { useUIStore } from "@mdcz/views/state/uiStore";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { confirmDialog } from "../common";
import { type DetailPanelCompareProps, DetailPanelView, toDetailViewItemFromScrapeResult } from "../detail";
import { buildDetailArtworkCandidates } from "../detail/imageCandidates";
import { DETAIL_IMAGE_VARIANTS, type DetailViewItem, type ImageCandidateVariant } from "../detail/types";
import { getT, useT } from "../i18n";
import {
  createEmptyEditableNfoData,
  type EditableNfoData,
  getNfoChangedFields,
  type NfoValidationErrors,
  normalizeEditableNfoData,
  serializeEditableNfoData,
  validateEditableNfoData,
} from "../nfo";
import type { DetailActionPort } from "./ports";

const EMPTY_RESULTS: ReturnType<typeof selectScrapeResults> = [];

const getDirFromPath = (path: string): string => {
  const normalized = path.replace(/[\\/]+$/u, "");
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return index >= 0 ? normalized.slice(0, index) : "";
};

const buildCandidateKey = (candidates: string[]): string => candidates.join("\u0000");
const readCandidateKey = (key: string): string[] => (key ? key.split("\u0000") : []);

function useResolvedArtworkSources(item: DetailViewItem | null, port: DetailActionPort) {
  const candidates = useMemo(() => buildDetailArtworkCandidates(item), [item]);
  const posterCandidateKey = buildCandidateKey(candidates.poster);
  const thumbCandidateKey = buildCandidateKey(candidates.thumb);
  const trailerCandidateKey = buildCandidateKey(
    [item?.trailerUrl, ...(item?.trailerFallbackUrls ?? [])].filter((value): value is string => Boolean(value)),
  );
  const baseDir = item?.outputPath ?? (item?.path ? getDirFromPath(item.path) : undefined);
  const [sources, setSources] = useState<[string[], string[], string[], string[]]>([[], [], [], []]);
  const [posterIndex, setPosterIndex] = useState(0);
  const [thumbIndex, setThumbIndex] = useState(0);
  const [trailerIndex, setTrailerIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const posterCandidates = readCandidateKey(posterCandidateKey);
    const thumbCandidates = readCandidateKey(thumbCandidateKey);
    const trailerCandidates = readCandidateKey(trailerCandidateKey);
    setPosterIndex(0);
    setThumbIndex(0);
    setTrailerIndex(0);

    const resolveSources = async () => {
      const resolved = await Promise.all([
        port.resolveImageCandidates(posterCandidates, baseDir, item, DETAIL_IMAGE_VARIANTS.poster),
        port.resolveImageCandidates(thumbCandidates, baseDir, item, DETAIL_IMAGE_VARIANTS.thumb),
        port.resolveImageCandidates(thumbCandidates, baseDir, item),
        port.resolveImageCandidates(trailerCandidates, baseDir, item),
      ]);

      if (!cancelled) setSources(resolved);
    };

    void resolveSources();

    return () => {
      cancelled = true;
    };
  }, [baseDir, posterCandidateKey, thumbCandidateKey, trailerCandidateKey, port, item]);

  const handlePosterError = useCallback(() => {
    setPosterIndex((currentIndex) => Math.min(currentIndex + 1, sources[0].length));
  }, [sources]);

  const handleThumbError = useCallback(() => {
    setThumbIndex((currentIndex) => Math.min(currentIndex + 1, sources[1].length));
  }, [sources]);

  const handleTrailerError = useCallback(() => {
    setTrailerIndex((currentIndex) => Math.min(currentIndex + 1, sources[3].length));
  }, [sources]);

  return {
    posterSrc: sources[0][posterIndex] ?? "",
    thumbSrc: sources[1][thumbIndex] ?? "",
    thumbPreviewSrc: sources[2][thumbIndex] ?? "",
    trailerSrc: sources[3][trailerIndex] ?? "",
    handlePosterError,
    handleThumbError,
    handleTrailerError,
  };
}

interface DetailPanelProps {
  port: DetailActionPort;
  item?: DetailViewItem | null;
  emptyMessage?: string;
  compare?: DetailPanelCompareProps;
}

export function DetailPanelAdapter({ port, item: explicitItem, emptyMessage, compare }: DetailPanelProps) {
  const t = useT();
  const results = useScrapeStore((state) => (explicitItem === undefined ? selectScrapeResults(state) : EMPTY_RESULTS));
  const selectedResultId = useUIStore((state) => (explicitItem === undefined ? state.selectedResultId : null));

  const item = useMemo(
    () =>
      explicitItem !== undefined
        ? explicitItem
        : (() => {
            const selectedGroup = findScrapeResultGroup(results, selectedResultId);
            return selectedGroup ? toDetailViewItemFromScrapeResult(selectedGroup.display) : null;
          })(),
    [explicitItem, results, selectedResultId],
  );
  const artwork = useResolvedArtworkSources(compare ? null : item, port);
  const resolveImageCandidates = useCallback(
    async (candidates: string[], baseDir?: string, variant?: ImageCandidateVariant) =>
      await port.resolveImageCandidates(candidates, baseDir, item, variant),
    [item, port],
  );

  const [nfoOpen, setNfoOpenRaw] = useState(false);
  const [nfoPath, setNfoPath] = useState("");
  const [nfoData, setNfoData] = useState<EditableNfoData>(createEmptyEditableNfoData);
  const [nfoInitialSnapshot, setNfoInitialSnapshot] = useState("");
  const [nfoValidationErrors, setNfoValidationErrors] = useState<NfoValidationErrors>({});
  const [nfoLoading, setNfoLoading] = useState(false);
  const [nfoSaving, setNfoSaving] = useState(false);
  const nfoDirty = nfoOpen && serializeEditableNfoData(nfoData) !== nfoInitialSnapshot;

  const openNfoEditor = useCallback(
    async (path: string) => {
      if (!item) return;
      try {
        setNfoLoading(true);
        const response = await port.readNfo(item, path);
        const editableData = normalizeEditableNfoData(response.crawlerData ?? {});
        setNfoPath(response.path);
        setNfoData(editableData);
        setNfoInitialSnapshot(serializeEditableNfoData(editableData));
        setNfoValidationErrors({});
        setNfoOpenRaw(true);
      } catch (error) {
        toast.error(getT().scrape.loadNfoFailed(toErrorMessage(error)), { id: "nfo" });
      } finally {
        setNfoLoading(false);
      }
    },
    [item, port],
  );

  const handleSaveNfo = useCallback(async () => {
    if (!item) return;
    const validation = validateEditableNfoData(nfoData);
    setNfoValidationErrors(validation.errors);
    if (!validation.valid || !validation.data) {
      const firstMessage = Object.values(validation.errors)[0] ?? getT().scrape.checkFormContent;
      toast.error(firstMessage, { id: "nfo" });
      return;
    }

    try {
      setNfoSaving(true);
      const changedFields = getNfoChangedFields(
        JSON.parse(nfoInitialSnapshot) as EditableNfoData,
        normalizeEditableNfoData(validation.data),
      );
      await port.writeNfo(item, nfoPath, validation.data, changedFields);
      toast.success(getT().scrape.nfoSaved, { id: "nfo" });
      setNfoInitialSnapshot(serializeEditableNfoData(normalizeEditableNfoData(validation.data)));
      setNfoOpenRaw(false);
    } catch (error) {
      toast.error(getT().scrape.saveNfoFailed(toErrorMessage(error)), { id: "nfo" });
    } finally {
      setNfoSaving(false);
    }
  }, [item, nfoData, nfoInitialSnapshot, nfoPath, port]);

  const setNfoOpen = useCallback(
    async (open: boolean) => {
      if (open) {
        setNfoOpenRaw(true);
        return;
      }
      if (nfoSaving) return;
      if (nfoDirty && !(await confirmDialog({ title: getT().scrape.discardNfoChanges, destructive: true }))) return;
      setNfoOpenRaw(false);
      setNfoValidationErrors({});
    },
    [nfoDirty, nfoSaving],
  );

  const handleFileAction = useCallback(
    (action: ((file: RootFileRef) => Promise<void>) | undefined, file: RootFileRef | undefined) => {
      if (action && file) void action(file).catch((error) => toast.error(toErrorMessage(error), { id: "file-action" }));
    },
    [],
  );

  const handleOpenNfo = useCallback(async () => {
    const path = item?.nfoPath ?? item?.path;
    if (path) await openNfoEditor(path);
  }, [item?.nfoPath, item?.path, openNfoEditor]);

  const actions = useMemo(
    () => ({
      play: port.play ? () => handleFileAction(port.play, item?.fileRef) : undefined,
      openFolder: port.openFolder ? () => handleFileAction(port.openFolder, item?.fileRef) : undefined,
      openNfo: handleOpenNfo,
    }),
    [handleFileAction, handleOpenNfo, item?.fileRef, port.openFolder, port.play],
  );

  useEffect(() => {
    const listener = (event: Event) => {
      const custom = event as CustomEvent<{ path?: string }>;
      const path = custom.detail?.path || item?.nfoPath || item?.path;
      if (!path) return;
      void openNfoEditor(path);
    };
    window.addEventListener("app:open-nfo", listener);
    return () => window.removeEventListener("app:open-nfo", listener);
  }, [item?.nfoPath, item?.path, openNfoEditor]);

  return (
    <DetailPanelView
      item={item}
      emptyMessage={emptyMessage ?? t.scrape.emptyMessage}
      compare={compare}
      posterSrc={artwork.posterSrc}
      thumbSrc={artwork.thumbSrc}
      thumbPreviewSrc={artwork.thumbPreviewSrc}
      trailerSrc={artwork.trailerSrc}
      nfo={{
        open: nfoOpen,
        data: nfoData,
        dirty: nfoDirty,
        errors: nfoValidationErrors,
        loading: nfoLoading,
        saving: nfoSaving,
        onOpenChange: setNfoOpen,
        onDataChange: setNfoData,
        onSave: handleSaveNfo,
      }}
      onPlay={actions.play}
      onOpenFolder={actions.openFolder}
      onOpenMetadataFolder={
        item?.nfoRef &&
        item.fileRef &&
        port.openFolder &&
        (item.nfoRef.rootId !== item.fileRef.rootId ||
          item.nfoRef.relativePath.split("/").slice(0, -1).join("/") !==
            item.fileRef.relativePath.split("/").slice(0, -1).join("/"))
          ? () => handleFileAction(port.openFolder, item.nfoRef)
          : undefined
      }
      onOpenNfo={actions.openNfo}
      onPosterError={artwork.handlePosterError}
      onThumbError={artwork.handleThumbError}
      onTrailerError={artwork.handleTrailerError}
      resolveImageCandidates={resolveImageCandidates}
      showFilePath={port.showFilePath}
      posterEditor={
        item?.status === "success" && item.fileRef
          ? {
              prepare: () => port.preparePosterCrop(item),
              save: (crop) => port.savePosterCrop(item, crop),
            }
          : undefined
      }
    />
  );
}

export { DetailPanelAdapter as DetailPanel };
