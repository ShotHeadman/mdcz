import { PauseCircle, Play, RotateCcw, StopCircle } from "lucide-react";
import { DetailPanel } from "@/components/DetailPanel";
import { ResultTree } from "@/components/ResultTree";
import { FloatingWorkbenchBar } from "@/components/shared/FloatingWorkbenchBar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Progress } from "@/components/ui/Progress";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/Resizable";
import { useScrapeStore } from "@/store/scrapeStore";

export interface ScrapeWorkbenchProps {
  onPauseScrape: () => void;
  onResumeScrape: () => void;
  onStopScrape: () => void;
  onRetryFailed: () => void;
  failedCount: number;
}

export default function ScrapeWorkbench({
  onPauseScrape,
  onResumeScrape,
  onStopScrape,
  onRetryFailed,
  failedCount,
}: ScrapeWorkbenchProps) {
  const { isScraping, scrapeStatus, progress } = useScrapeStore();
  const showControls = isScraping || failedCount > 0;

  return (
    <div className="relative h-full overflow-hidden bg-surface-canvas">
      <div className="flex h-full min-h-0 p-4">
        <ResizablePanelGroup orientation="horizontal" className="flex-1 gap-3">
          <ResizablePanel
            id="result-list"
            defaultSize={34}
            minSize={22}
            className="flex flex-col overflow-hidden rounded-quiet-lg bg-surface-low/80"
          >
            <ResultTree />
          </ResizablePanel>

          <ResizableHandle className="w-1 rounded-full bg-transparent transition-colors hover:bg-foreground/10" />

          <ResizablePanel
            id="detail-view"
            defaultSize={66}
            minSize={32}
            className="flex flex-col overflow-hidden rounded-quiet-lg bg-surface-floating/94"
          >
            <DetailPanel />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {showControls && (
        <FloatingWorkbenchBar contentClassName="mx-auto flex w-full max-w-3xl items-center gap-4 px-4 py-3 md:px-5">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            {isScraping && (
              <div className="flex min-w-48 items-center gap-3">
                <Progress value={progress} className="h-1.5 w-24 md:w-28" />
                <span className="w-10 font-numeric text-[11px] font-bold text-foreground">{Math.round(progress)}%</span>
              </div>
            )}
          </div>

          {isScraping && (
            <>
              <Button
                type="button"
                variant="ghost"
                className="rounded-quiet-capsule"
                onClick={scrapeStatus === "paused" ? onResumeScrape : onPauseScrape}
              >
                {scrapeStatus === "paused" ? <Play className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />}
                {scrapeStatus === "paused" ? "恢复" : "暂停"}
              </Button>
              <Button type="button" variant="destructive" className="rounded-quiet-capsule" onClick={onStopScrape}>
                <StopCircle className="h-4 w-4" />
                停止
              </Button>
            </>
          )}

          {!isScraping && failedCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              className="rounded-quiet-capsule text-destructive hover:text-destructive"
              onClick={onRetryFailed}
            >
              <RotateCcw className="h-4 w-4" />
              重试失败
              <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                {failedCount}
              </Badge>
            </Button>
          )}
        </FloatingWorkbenchBar>
      )}
    </div>
  );
}
