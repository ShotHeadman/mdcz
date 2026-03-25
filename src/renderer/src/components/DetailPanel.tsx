import type { MaintenanceItemResult, MaintenancePreviewItem } from "@shared/types";
import { CheckCircle2, FileText, FolderOpen, GitCompareArrows, ImageIcon, Play, XCircle } from "lucide-react";
import { useMemo } from "react";
import { toDetailViewItemFromScrapeResult } from "@/components/detail/detailViewAdapters";
import type { DetailViewItem } from "@/components/detail/types";
import { useDetailViewController } from "@/components/detail/useDetailViewController";
import ChangeDiffView from "@/components/maintenance/ChangeDiffView";
import PathPlanView from "@/components/maintenance/PathPlanView";
import { SceneImageGallery } from "@/components/SceneImageGallery";
import { Row } from "@/components/shared/Row";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { Separator } from "@/components/ui/Separator";
import { findScrapeResultGroup } from "@/lib/scrapeResultGrouping";
import { useScrapeStore } from "@/store/scrapeStore";
import { useUIStore } from "@/store/uiStore";
import { getDirFromPath } from "@/utils/path";

const EMPTY_RESULTS: ReturnType<typeof useScrapeStore.getState>["results"] = [];

interface DetailPanelCompareProps {
  result?: MaintenanceItemResult | MaintenancePreviewItem;
  badgeLabel?: string;
  titleOverride?: string;
}

interface DetailPanelProps {
  item?: DetailViewItem | null;
  emptyMessage?: string;
  compare?: DetailPanelCompareProps;
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-sm opacity-60">
      <FileText className="h-12 w-12 mb-2 opacity-20" />
      {message}
    </div>
  );
}

function DetailPathBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-2 text-xs text-muted-foreground">{label}</div>
      <div className="break-all rounded bg-muted/50 px-2 py-1.5 font-mono text-[10px] opacity-70">{value}</div>
    </div>
  );
}

function DetailErrorBlock({ value }: { value: string }) {
  return (
    <div>
      <div className="mb-2 text-xs text-muted-foreground">错误详情</div>
      <div className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-500 dark:bg-red-950/20">{value}</div>
    </div>
  );
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
    nfoContent,
    nfoLoading,
    nfoSaving,
    setNfoOpen,
    setNfoContent,
    handlePlay,
    handleOpenFolder,
    handleOpenNfo,
    handlePosterError,
    handleThumbError,
    handleSaveNfo,
  } = useDetailViewController(compareMode ? null : item);

  if (!item) {
    return <EmptyState message={emptyMessage} />;
  }

  if (compareMode) {
    const compareError = compare?.result?.error ?? (!compare?.result ? item.errorMessage : undefined);
    const hasComparedResult = Boolean(compare?.result);
    const shouldRenderDiffs = hasComparedResult || !compareError;

    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="border-b bg-background/80 px-4 py-2.5 backdrop-blur">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight">{item.number}</h2>
                {item.status === "success" ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {compare?.titleOverride ?? item.title ?? item.number}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
              <Badge variant="outline" className="gap-1 self-start rounded-full px-2.5 py-1 text-xs sm:self-auto">
                <GitCompareArrows className="h-3.5 w-3.5" />
                {compare?.badgeLabel ?? "数据对比"}
              </Badge>
            </div>
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="flex min-h-full flex-col space-y-4 p-4">
            {compareError && item.path && <DetailPathBlock label="文件路径" value={item.path} />}

            {compareError && <DetailErrorBlock value={compareError} />}

            {shouldRenderDiffs && (
              <ChangeDiffView
                entryId={item.id}
                diffs={compare?.result?.fieldDiffs ?? []}
                unchangedDiffs={compare?.result?.unchangedFieldDiffs ?? []}
                hasResult={hasComparedResult}
              />
            )}

            {compare?.result?.pathDiff && <PathPlanView pathDiff={compare.result.pathDiff} />}
          </div>
        </ScrollArea>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 border-b bg-background/80 px-4 py-2.5 backdrop-blur">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight">{item.number}</h2>
                {item.status === "success" ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
              </div>
              {item.title && <p className="mt-1 text-sm text-muted-foreground">{item.title}</p>}
            </div>
            <div className="flex shrink-0 gap-1">
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handlePlay} title="播放">
                <Play className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleOpenFolder} title="打开文件夹">
                <FolderOpen className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={handleOpenNfo}
                title="编辑 NFO"
                disabled={nfoLoading}
              >
                <FileText className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="min-w-0 space-y-4 p-4">
            {item.minimalErrorView ? (
              <>
                {item.path && <DetailPathBlock label="文件路径" value={item.path} />}
                {item.errorMessage && <DetailErrorBlock value={item.errorMessage} />}
              </>
            ) : (
              <>
                <div className="flex items-stretch gap-4">
                  <div className="w-36 shrink-0 self-stretch">
                    {posterSrc ? (
                      <div className="relative aspect-2/3 overflow-hidden rounded-lg border bg-muted/20">
                        <img
                          src={posterSrc}
                          alt="Poster"
                          className="h-full w-full object-cover"
                          onError={handlePosterError}
                        />
                      </div>
                    ) : (
                      <div className="flex aspect-2/3 w-full items-center justify-center rounded-lg border border-dashed bg-muted/20">
                        <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1 space-y-1">
                    {item.actors && item.actors.length > 0 && (
                      <Row label="演员" variant="metadata">
                        {item.actors.join(", ")}
                      </Row>
                    )}
                    {item.release && (
                      <Row label="发行" variant="metadata">
                        {item.release}
                      </Row>
                    )}
                    {item.duration && (
                      <Row label="时长" variant="metadata">
                        {item.duration}
                      </Row>
                    )}
                    {item.resolution && (
                      <Row label="分辨率" variant="metadata">
                        {item.resolution}
                      </Row>
                    )}
                    {item.codec && (
                      <Row label="编码" variant="metadata">
                        {item.codec}
                      </Row>
                    )}
                    {item.bitrate && (
                      <Row label="码率" variant="metadata">
                        {item.bitrate}
                      </Row>
                    )}
                    {item.studio && (
                      <Row label="制片" variant="metadata">
                        {item.studio}
                      </Row>
                    )}
                    {item.series && (
                      <Row label="系列" variant="metadata">
                        {item.series}
                      </Row>
                    )}
                    {item.publisher && (
                      <Row label="发行商" variant="metadata">
                        {item.publisher}
                      </Row>
                    )}
                    {item.score && (
                      <Row label="评分" variant="metadata">
                        {item.score}
                      </Row>
                    )}
                    {item.directors && item.directors.length > 0 && (
                      <Row label="导演" variant="metadata">
                        {item.directors.join(", ")}
                      </Row>
                    )}
                  </div>
                </div>

                {item.tags && item.tags.length > 0 && (
                  <div>
                    <div className="mb-2 text-xs text-muted-foreground">标签</div>
                    <div className="flex flex-wrap gap-1.5">
                      {item.tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="h-5 px-2 py-0.5 text-[10px]">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <Separator />

                {thumbSrc && (
                  <div className="overflow-hidden rounded-xl border bg-black/5">
                    <div className="flex max-h-112 items-center justify-center bg-muted/10 p-3">
                      <img
                        src={thumbSrc}
                        alt="Thumb artwork"
                        className="max-h-100 max-w-full object-contain"
                        onError={handleThumbError}
                      />
                    </div>
                  </div>
                )}

                {item.sceneImages && item.sceneImages.length > 0 && (
                  <>
                    <Separator />
                    <SceneImageGallery
                      images={item.sceneImages}
                      baseDir={item.outputPath ?? (item.path ? getDirFromPath(item.path) : undefined)}
                    />
                  </>
                )}

                <Separator />

                {item.outline && (
                  <div>
                    <div className="mb-2 text-xs text-muted-foreground">内容简介</div>
                    <p className="wrap-break-word whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                      {item.outline}
                    </p>
                  </div>
                )}

                {item.path && <DetailPathBlock label="文件路径" value={item.path} />}

                {item.errorMessage && <DetailErrorBlock value={item.errorMessage} />}
              </>
            )}
          </div>
        </ScrollArea>
      </div>

      <Dialog open={nfoOpen} onOpenChange={setNfoOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>编辑 NFO 文件</DialogTitle>
          </DialogHeader>
          <textarea
            value={nfoContent}
            onChange={(event) => setNfoContent(event.target.value)}
            className="h-[60vh] w-full resize-none rounded-md border bg-background p-3 font-mono text-[11px]"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNfoOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSaveNfo} disabled={nfoSaving}>
              保存修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
