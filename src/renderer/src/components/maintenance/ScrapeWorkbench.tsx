import { PauseCircle, Play, RotateCcw, StopCircle } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { DetailPanel } from "@/components/DetailPanel";
import { ResultTree } from "@/components/ResultTree";
import { FloatingWorkbenchBar } from "@/components/shared/FloatingWorkbenchBar";
import { ReturnToWorkbenchSetupButton } from "@/components/shared/ReturnToWorkbenchSetupButton";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Progress } from "@/components/ui/Progress";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/Resizable";
import { useScrapeStore } from "@/store/scrapeStore";
import { useUIStore } from "@/store/uiStore";

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
  const { isScraping, scrapeStatus, progress, resultsCount, reset } = useScrapeStore(
    useShallow((state) => ({
      isScraping: state.isScraping,
      scrapeStatus: state.scrapeStatus,
      progress: state.progress,
      resultsCount: state.results.length,
      reset: state.reset,
    })),
  );
  const setSelectedResultId = useUIStore((state) => state.setSelectedResultId);
  const showCompletedActions = !isScraping && resultsCount > 0;
  const showControls = isScraping || showCompletedActions;
  const stopping = scrapeStatus === "stopping";
  const handleReturnToSetup = () => {
    setSelectedResultId(null);
    reset();
  };
  const barContentClassName = isScraping
    ? "mx-auto flex w-fit max-w-[min(92vw,32rem)] items-center gap-4 px-4 py-3 md:px-5"
    : "mx-auto flex w-fit max-w-[min(92vw,32rem)] items-center gap-2 px-3 py-2.5 md:px-4";

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
        <FloatingWorkbenchBar contentClassName={barContentClassName}>
          {isScraping && (
            <div className="flex items-center gap-3">
              <Progress value={progress} className="h-1.5 w-24 md:w-28" />
              <span className="font-numeric text-[11px] font-bold text-foreground">{Math.round(progress)}%</span>
            </div>
          )}

          {isScraping && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="rounded-quiet-capsule"
                onClick={scrapeStatus === "paused" ? onResumeScrape : onPauseScrape}
                disabled={stopping}
                aria-label={scrapeStatus === "paused" ? "恢复刮削任务" : "暂停刮削任务"}
                title={scrapeStatus === "paused" ? "恢复" : "暂停"}
              >
                {scrapeStatus === "paused" ? <Play className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="icon-sm"
                className="rounded-quiet-capsule"
                onClick={onStopScrape}
                disabled={stopping}
                aria-label="停止刮削任务"
                title="停止"
              >
                <StopCircle className="h-4 w-4" />
              </Button>
            </>
          )}

          {showCompletedActions && (
            <>
              <ReturnToWorkbenchSetupButton
                dialogDescription="返回后会清空当前刮削结果并回到工作台初始页面。确定继续吗？"
                onConfirm={handleReturnToSetup}
              />
              {failedCount > 0 && (
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
            </>
          )}
        </FloatingWorkbenchBar>
      )}
    </div>
  );
}
