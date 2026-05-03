import { type DetailPanelCompareProps, DetailPanelView, toDetailViewItemFromScrapeResult } from "@mdcz/views/detail";
import { useMemo } from "react";
import { useDetailViewController } from "@/components/detail/useDetailViewController";
import { SceneImageGallery } from "@/components/SceneImageGallery";
import { findScrapeResultGroup } from "@/lib/scrapeResultGrouping";
import { useScrapeStore } from "@/store/scrapeStore";
import { useUIStore } from "@/store/uiStore";

const EMPTY_RESULTS: ReturnType<typeof useScrapeStore.getState>["results"] = [];

interface DetailPanelProps {
  item?: import("@mdcz/views/detail").DetailViewItem | null;
  emptyMessage?: string;
  compare?: DetailPanelCompareProps;
}

export function DetailPanel({
  item: explicitItem,
  emptyMessage = "请选择一个项目以查看详情",
  compare,
}: DetailPanelProps = {}) {
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

  const compareMode = Boolean(compare);
  const {
    posterSrc,
    thumbSrc,
    nfoOpen,
    nfoData,
    nfoDirty,
    nfoValidationErrors,
    nfoLoading,
    nfoSaving,
    setNfoOpen,
    setNfoData,
    handlePlay,
    handleOpenFolder,
    handleOpenNfo,
    handlePosterError,
    handleThumbError,
    handleSaveNfo,
  } = useDetailViewController(compareMode ? null : item);

  return (
    <DetailPanelView
      item={item}
      emptyMessage={emptyMessage}
      compare={compare}
      posterSrc={posterSrc}
      thumbSrc={thumbSrc}
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
      onPlay={handlePlay}
      onOpenFolder={handleOpenFolder}
      onOpenNfo={handleOpenNfo}
      onPosterError={handlePosterError}
      onThumbError={handleThumbError}
      renderSceneImages={(props) => <SceneImageGallery {...props} />}
    />
  );
}
