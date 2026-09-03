import { Badge, Button, Progress, ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@mdcz/ui";
import { PauseCircle, Play, RotateCcw, StopCircle } from "lucide-react";
import type { ReactNode } from "react";
import { FloatingWorkbenchBar } from "./FloatingWorkbenchBar";
import { ReturnToWorkbenchSetupButton } from "./ReturnToWorkbenchSetupButton";

export interface ScrapeWorkbenchFrameProps {
  list: ReactNode;
  detail: ReactNode;
  isScraping: boolean;
  scrapeStatus: "idle" | "running" | "stopping" | "paused";
  progress: number;
  showCompletedActions: boolean;
  failedCount: number;
  onPauseScrape: () => void;
  onResumeScrape: () => void;
  onStopScrape: () => void;
  onRetryFailed: () => void;
  onReturnToSetup: () => void;
}

export function ScrapeWorkbenchFrame({
  list,
  detail,
  isScraping,
  scrapeStatus,
  progress,
  showCompletedActions,
  failedCount,
  onPauseScrape,
  onResumeScrape,
  onStopScrape,
  onRetryFailed,
  onReturnToSetup,
}: ScrapeWorkbenchFrameProps) {
  const showControls = isScraping || showCompletedActions;
  const stopping = scrapeStatus === "stopping";
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
            {list}
          </ResizablePanel>

          <ResizableHandle className="w-1 rounded-full bg-transparent transition-colors hover:bg-foreground/10" />

          <ResizablePanel
            id="detail-view"
            defaultSize={66}
            minSize={32}
            className="flex flex-col overflow-hidden rounded-quiet-lg bg-surface-floating/94"
          >
            {detail}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {showControls ? (
        <FloatingWorkbenchBar contentClassName={barContentClassName}>
          {isScraping ? (
            <div className="flex items-center gap-3">
              <Progress value={progress} className="h-1.5 w-24 md:w-28" />
              <span className="font-numeric text-[11px] font-bold text-foreground">{Math.round(progress)}%</span>
            </div>
          ) : null}

          {isScraping ? (
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
          ) : null}

          {showCompletedActions ? (
            <>
              <ReturnToWorkbenchSetupButton
                dialogDescription="返回后会清空当前刮削结果并回到工作台初始页面。确定继续吗？"
                onConfirm={onReturnToSetup}
              />
              {failedCount > 0 ? (
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
              ) : null}
            </>
          ) : null}
        </FloatingWorkbenchBar>
      ) : null}
    </div>
  );
}

export interface MaintenanceWorkbenchFrameProps {
  list: ReactNode;
  detail: ReactNode;
  batchBar: ReactNode;
}

export function MaintenanceWorkbenchFrame({ list, detail, batchBar }: MaintenanceWorkbenchFrameProps) {
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-surface-canvas">
      <div className="flex flex-1 min-h-0 p-4 md:p-6 lg:p-8">
        <ResizablePanelGroup orientation="horizontal" className="flex-1 gap-3">
          <ResizablePanel
            id="maintenance-entry-list"
            defaultSize={36}
            minSize={24}
            className="flex flex-col overflow-hidden rounded-quiet-lg bg-surface-low/80"
          >
            {list}
          </ResizablePanel>

          <ResizableHandle className="w-1 rounded-full bg-transparent hover:bg-foreground/10" />

          <ResizablePanel
            id="maintenance-detail-view"
            defaultSize={64}
            minSize={30}
            className="flex flex-col overflow-hidden rounded-quiet-lg bg-surface-floating/94"
          >
            {detail}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      <FloatingWorkbenchBar contentClassName="mx-auto flex w-fit max-w-[min(92vw,42rem)] items-center gap-3 px-3 py-2.5 md:px-4">
        {batchBar}
      </FloatingWorkbenchBar>
    </div>
  );
}
