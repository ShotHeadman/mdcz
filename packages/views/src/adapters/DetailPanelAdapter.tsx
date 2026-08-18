import { toErrorMessage } from "@mdcz/shared/error";
import type { NormalizedCropRegion } from "@mdcz/shared/posterCrop";
import type { CrawlerData } from "@mdcz/shared/types";
import { findScrapeResultGroup } from "@mdcz/shared/viewModels/scrapeResultGrouping";
import { useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { useUIStore } from "@mdcz/views/state/uiStore";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { type DetailPanelCompareProps, DetailPanelView, toDetailViewItemFromScrapeResult } from "../detail";
import { buildDetailArtworkCandidates } from "../detail/imageCandidates";
import type { DetailViewItem } from "../detail/types";
import {
  createEmptyEditableNfoData,
  type EditableNfoData,
  type NfoValidationErrors,
  normalizeEditableNfoData,
  serializeEditableNfoData,
  validateEditableNfoData,
} from "../nfo";
import type { ActionAvailability, DetailActionPort, PosterCropEditSession } from "./ports";

const EMPTY_RESULTS: ReturnType<typeof useScrapeStore.getState>["results"] = [];

const isActionVisible = (availability: ActionAvailability | undefined) => availability !== "hidden";

const getDirFromPath = (path: string): string => {
  const normalized = path.replace(/[\\/]+$/u, "");
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return index >= 0 ? normalized.slice(0, index) : "";
};

const buildCandidateKey = (candidates: string[]): string => candidates.join("\u0000");
const readCandidateKey = (key: string): string[] => (key ? key.split("\u0000") : []);

function useResolvedArtworkSources(item: DetailViewItem | null, port: DetailActionPort, posterOverride: string) {
  const candidates = useMemo(() => buildDetailArtworkCandidates(item), [item]);
  const posterCandidateKey = buildCandidateKey(candidates.poster);
  const thumbCandidateKey = buildCandidateKey(candidates.thumb);
  const baseDir = item?.outputPath ?? (item?.path ? getDirFromPath(item.path) : undefined);
  const [posterSources, setPosterSources] = useState<string[]>([]);
  const [thumbSources, setThumbSources] = useState<string[]>([]);
  const [posterIndex, setPosterIndex] = useState(0);
  const [thumbIndex, setThumbIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const posterCandidates = readCandidateKey(posterCandidateKey);
    const thumbCandidates = readCandidateKey(thumbCandidateKey);
    setPosterIndex(0);
    setThumbIndex(0);

    const resolveSources = async () => {
      const [nextPosterSources, nextThumbSources] = await Promise.all([
        port.resolveImageCandidates(posterCandidates, baseDir, item),
        port.resolveImageCandidates(thumbCandidates, baseDir, item),
      ]);

      if (!cancelled) {
        setPosterSources(nextPosterSources);
        setThumbSources(nextThumbSources);
      }
    };

    void resolveSources();

    return () => {
      cancelled = true;
    };
  }, [baseDir, posterCandidateKey, thumbCandidateKey, port, item]);

  const handlePosterError = useCallback(() => {
    setPosterIndex((currentIndex) => Math.min(currentIndex + 1, posterSources.length));
  }, [posterSources.length]);

  const handleThumbError = useCallback(() => {
    setThumbIndex((currentIndex) => Math.min(currentIndex + 1, thumbSources.length));
  }, [thumbSources.length]);

  return {
    posterSrc: posterOverride || posterSources[posterIndex] || "",
    thumbSrc: thumbSources[thumbIndex] ?? "",
    handlePosterError,
    handleThumbError,
  };
}

interface DetailPanelProps {
  port: DetailActionPort;
  item?: DetailViewItem | null;
  emptyMessage?: string;
  compare?: DetailPanelCompareProps;
}

export function DetailPanelAdapter({
  port,
  item: explicitItem,
  emptyMessage = "请选择一个项目以查看详情",
  compare,
}: DetailPanelProps) {
  const results = useScrapeStore((state) => (explicitItem === undefined ? state.results : EMPTY_RESULTS));
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
  const [posterOverride, setPosterOverride] = useState("");
  const artwork = useResolvedArtworkSources(compare ? null : item, port, posterOverride);
  const resolveImageCandidates = useCallback(
    async (candidates: string[], baseDir?: string) => await port.resolveImageCandidates(candidates, baseDir, item),
    [item, port],
  );

  const [nfoOpen, setNfoOpenRaw] = useState(false);
  const [nfoPath, setNfoPath] = useState("");
  const [nfoData, setNfoData] = useState<EditableNfoData>(createEmptyEditableNfoData);
  const [nfoInitialSnapshot, setNfoInitialSnapshot] = useState("");
  const [nfoValidationErrors, setNfoValidationErrors] = useState<NfoValidationErrors>({});
  const [nfoLoading, setNfoLoading] = useState(false);
  const [nfoSaving, setNfoSaving] = useState(false);
  const [posterEditorOpen, setPosterEditorOpen] = useState(false);
  const [posterCropSession, setPosterCropSession] = useState<PosterCropEditSession | null>(null);
  const [posterCrop, setPosterCrop] = useState<NormalizedCropRegion | null>(null);
  const [posterCropSaving, setPosterCropSaving] = useState(false);
  const nfoDirty = nfoOpen && serializeEditableNfoData(nfoData) !== nfoInitialSnapshot;
  const posterCropDirty =
    posterEditorOpen &&
    posterCropSession !== null &&
    posterCrop !== null &&
    JSON.stringify(posterCrop) !== JSON.stringify(posterCropSession.initialCrop);

  useEffect(() => {
    let cancelled = false;
    setPosterOverride("");
    setPosterCropSession(null);
    setPosterCrop(null);
    if (!item || item.status !== "success" || !isActionVisible(port.capabilities?.editPoster)) return;
    void port
      .preparePosterCrop(item)
      .then((session) => {
        if (cancelled) return;
        setPosterCropSession(session);
        setPosterCrop(session.initialCrop);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [item, port, port.capabilities?.editPoster]);

  const openNfoEditor = useCallback(
    async (path: string) => {
      if (!item) {
        toast.info("请先选择一个项目");
        return;
      }
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
        toast.error(`加载 NFO 失败: ${toErrorMessage(error)}`);
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
      const firstMessage = Object.values(validation.errors)[0] ?? "请检查表单内容";
      toast.error(firstMessage);
      return;
    }

    try {
      setNfoSaving(true);
      await port.writeNfo(item, nfoPath, validation.data as CrawlerData);
      toast.success("NFO 已保存");
      setNfoInitialSnapshot(serializeEditableNfoData(normalizeEditableNfoData(validation.data)));
      setNfoOpenRaw(false);
    } catch (error) {
      toast.error(`保存 NFO 失败: ${toErrorMessage(error)}`);
    } finally {
      setNfoSaving(false);
    }
  }, [item, nfoData, nfoPath, port]);

  const setNfoOpen = useCallback(
    (open: boolean) => {
      if (open) {
        setNfoOpenRaw(true);
        return;
      }
      if (nfoSaving) return;
      if (nfoDirty && !window.confirm("放弃未保存的 NFO 修改？")) return;
      setNfoOpenRaw(false);
      setNfoValidationErrors({});
    },
    [nfoDirty, nfoSaving],
  );

  const handlePlay = useCallback(() => {
    if (!item) {
      toast.info("请先选择一个项目");
      return;
    }
    void port.play(item);
  }, [item, port]);

  const handleOpenFolder = useCallback(() => {
    if (!item) {
      toast.info("请先选择一个项目");
      return;
    }
    void port.openFolder(item);
  }, [item, port]);

  const handleOpenNfo = useCallback(async () => {
    const path = item?.nfoPath ?? item?.path;
    if (!path) {
      toast.info("请先选择一个项目");
      return;
    }
    await openNfoEditor(path);
  }, [item?.nfoPath, item?.path, openNfoEditor]);

  const handleOpenPosterEditor = useCallback(() => {
    if (!posterCropSession) return;
    setPosterCrop(posterCropSession.initialCrop);
    setPosterEditorOpen(true);
  }, [posterCropSession]);

  const setPosterEditorOpenSafe = useCallback(
    (open: boolean) => {
      if (open) {
        setPosterEditorOpen(true);
        return;
      }
      if (posterCropSaving) return;
      if (posterCropDirty && !window.confirm("放弃未保存的封面修改？")) return;
      setPosterEditorOpen(false);
    },
    [posterCropDirty, posterCropSaving],
  );

  const handleSavePosterCrop = useCallback(async () => {
    if (!item || !posterCrop) return;
    try {
      setPosterCropSaving(true);
      const result = await port.savePosterCrop(item, posterCrop);
      setPosterOverride(result.posterUrl);
      setPosterEditorOpen(false);
      toast.success("封面已保存");
      void port
        .preparePosterCrop(item)
        .then((refreshed) => {
          setPosterCropSession(refreshed);
          setPosterCrop(refreshed.initialCrop);
        })
        .catch(() => undefined);
    } catch (error) {
      toast.error(`保存封面失败: ${toErrorMessage(error)}`);
    } finally {
      setPosterCropSaving(false);
    }
  }, [item, port, posterCrop]);

  const actions = useMemo(
    () => ({
      play: isActionVisible(port.capabilities?.play) ? handlePlay : undefined,
      openFolder: isActionVisible(port.capabilities?.openFolder) ? handleOpenFolder : undefined,
      openNfo: isActionVisible(port.capabilities?.openNfo) ? handleOpenNfo : undefined,
    }),
    [
      handleOpenFolder,
      handleOpenNfo,
      handlePlay,
      port.capabilities?.openFolder,
      port.capabilities?.openNfo,
      port.capabilities?.play,
    ],
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
      emptyMessage={emptyMessage}
      compare={compare}
      posterSrc={artwork.posterSrc}
      thumbSrc={artwork.thumbSrc}
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
      onOpenNfo={actions.openNfo}
      onPosterError={artwork.handlePosterError}
      onThumbError={artwork.handleThumbError}
      resolveImageCandidates={resolveImageCandidates}
      showFilePath={port.showFilePath}
      posterEditor={{
        open: posterEditorOpen,
        session: posterCropSession,
        crop: posterCrop,
        saving: posterCropSaving,
        onCropChange: setPosterCrop,
        onOpen: handleOpenPosterEditor,
        onOpenChange: setPosterEditorOpenSafe,
        onSave: handleSavePosterCrop,
      }}
    />
  );
}

export { DetailPanelAdapter as DetailPanel };
