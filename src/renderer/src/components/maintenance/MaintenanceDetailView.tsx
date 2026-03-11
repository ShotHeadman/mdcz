import type { LocalScanEntry, MaintenanceItemResult, MaintenancePreviewItem } from "@shared/types";
import { CheckCircle2, FileText, GitCompareArrows, XCircle } from "lucide-react";
import { DetailPanel } from "@/components/DetailPanel";
import ChangeDiffView from "@/components/maintenance/ChangeDiffView";
import PathPlanView from "@/components/maintenance/PathPlanView";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent } from "@/components/ui/Card";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { useMaintenanceStore } from "@/store/maintenanceStore";
import type { ScrapeResult } from "@/store/scrapeStore";

const formatDuration = (durationSeconds: number | undefined): string | undefined => {
  if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return undefined;
  }

  const totalSeconds = Math.round(durationSeconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const getDisplayTitle = (entry: LocalScanEntry) =>
  entry.crawlerData?.title_zh ?? entry.crawlerData?.title ?? entry.fileInfo.fileName;

const toDetailItem = (entry: LocalScanEntry, result?: MaintenanceItemResult | MaintenancePreviewItem): ScrapeResult => {
  const data = entry.crawlerData;
  return {
    id: entry.id,
    status: result?.status === "failed" || result?.status === "blocked" ? "failed" : "success",
    number: entry.fileInfo.number,
    path: entry.videoPath,
    title: getDisplayTitle(entry),
    actors: data?.actors,
    outline: data?.plot_zh ?? data?.plot,
    tags: data?.genres,
    release: data?.release_date,
    duration: formatDuration(data?.durationSeconds),
    resolution: entry.fileInfo.resolution,
    directors: data?.director ? [data.director] : undefined,
    series: data?.series,
    studio: data?.studio,
    publisher: data?.publisher,
    score: typeof data?.rating === "number" ? String(data.rating) : undefined,
    poster_url: entry.assets.poster ?? data?.poster_url,
    thumb_url: entry.assets.thumb ?? entry.assets.fanart ?? data?.thumb_url ?? data?.fanart_url,
    fanart_url: entry.assets.fanart ?? entry.assets.thumb ?? data?.fanart_url ?? data?.thumb_url,
    output_path: entry.currentDir,
    scene_images: entry.assets.sceneImages.length > 0 ? entry.assets.sceneImages : data?.sample_images,
    error_msg: result?.error,
  };
};

export default function MaintenanceDetailView() {
  const { entries, activeId, presetId, previewResults, itemResults } = useMaintenanceStore((state) => ({
    entries: state.entries,
    activeId: state.activeId,
    presetId: state.presetId,
    previewResults: state.previewResults,
    itemResults: state.itemResults,
  }));

  const activeEntry = entries.find((entry) => entry.id === activeId) ?? null;
  const activePreview = activeEntry ? previewResults[activeEntry.id] : undefined;
  const activeResult = activeEntry ? itemResults[activeEntry.id] : undefined;
  const displayResult = activeResult ?? activePreview;

  if (!activeEntry) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center text-sm text-muted-foreground">
        <FileText className="mb-3 h-12 w-12 opacity-20" />
        请选择一个项目以查看详情
      </div>
    );
  }

  if (presetId === "refresh_data" || presetId === "rebuild_all") {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="border-b bg-background/80 px-4 py-3 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight">{activeEntry.fileInfo.number}</h2>
                {(displayResult?.status === "success" || displayResult?.status === "ready") && (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                )}
                {(displayResult?.status === "failed" || displayResult?.status === "blocked") && (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
              </div>
              <p className="mt-1 truncate text-sm text-muted-foreground">{getDisplayTitle(activeEntry)}</p>
            </div>
            <Badge variant="outline" className="gap-1 rounded-full px-2.5 py-1 text-xs">
              <GitCompareArrows className="h-3.5 w-3.5" />
              数据对比
            </Badge>
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-4 p-4">
            {displayResult?.error && (
              <Card className="rounded-xl border-destructive/20 bg-destructive/5 shadow-none">
                <CardContent className="p-4 text-sm text-destructive">{displayResult.error}</CardContent>
              </Card>
            )}

            <ChangeDiffView entryId={activeEntry.id} diffs={displayResult?.fieldDiffs ?? []} />

            {displayResult?.pathDiff && <PathPlanView pathDiff={displayResult.pathDiff} />}
          </div>
        </ScrollArea>
      </div>
    );
  }

  return <DetailPanel item={toDetailItem(activeEntry, displayResult)} />;
}
