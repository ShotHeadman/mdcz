import { toErrorMessage } from "@mdcz/shared/error";
import type { CrawlerData } from "@mdcz/shared/types";
import { type DetailPanelCompareProps, DetailPanelView, toDetailViewItemFromScrapeResult } from "@mdcz/views/detail";
import {
  createEmptyEditableNfoData,
  type EditableNfoData,
  type NfoValidationErrors,
  normalizeEditableNfoData,
  serializeEditableNfoData,
  validateEditableNfoData,
} from "@mdcz/views/nfo";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useScrapeStore } from "../stores/scrapeStore";
import { useUIStore } from "../stores/uiStore";
import { findScrapeResultGroup } from "../viewModels/scrapeResultGrouping";
import type { ActionAvailability, DetailActionPort } from "./ports";

const EMPTY_RESULTS: ReturnType<typeof useScrapeStore.getState>["results"] = [];

const isActionVisible = (availability: ActionAvailability | undefined) => availability !== "hidden";

interface DetailPanelProps {
  port: DetailActionPort;
  item?: import("@mdcz/views/detail").DetailViewItem | null;
  emptyMessage?: string;
  compare?: DetailPanelCompareProps;
  renderSceneImages?: (props: {
    images: string[];
    baseDir?: string;
    label?: string;
    variant?: "compact" | "filmstrip";
  }) => ReactNode;
}

export function DetailPanelAdapter({
  port,
  item: explicitItem,
  emptyMessage = "请选择一个项目以查看详情",
  compare,
  renderSceneImages,
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
      posterSrc={item?.posterUrl ?? ""}
      thumbSrc={item?.thumbUrl ?? item?.fanartUrl ?? ""}
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
      renderSceneImages={renderSceneImages}
    />
  );
}

export { DetailPanelAdapter as DetailPanel };
