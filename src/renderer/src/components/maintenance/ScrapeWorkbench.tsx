import { DetailPanel } from "@/components/DetailPanel";
import { ResultTree } from "@/components/ResultTree";
import { Progress } from "@/components/ui/Progress";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/Resizable";
import { cn } from "@/lib/utils";
import { useScrapeStore } from "@/store/scrapeStore";
import EmptyWorkbench from "./EmptyWorkbench";

export interface ScrapeWorkbenchProps {
  mediaPath: string;
  onChooseMediaDirectory: () => void;
  onStartScrape: () => void;
}

export default function ScrapeWorkbench({ mediaPath, onChooseMediaDirectory }: ScrapeWorkbenchProps) {
  const { isScraping, progress, currentFilePath, statusText, results } = useScrapeStore();

  if (!mediaPath) {
    return <EmptyWorkbench variant="no-path" action={onChooseMediaDirectory} />;
  }

  if (results.length === 0 && !isScraping) {
    return <EmptyWorkbench variant="ready" mediaPath={mediaPath} />;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col">
        <div
          className={cn(
            "shrink-0 overflow-hidden transition-all duration-300 ease-in-out",
            isScraping ? "h-13 opacity-100" : "h-0 opacity-0",
          )}
        >
          <div className="px-8 pt-4 pb-0">
            <div className="flex items-center gap-4">
              <Progress value={progress} className="h-1.5 flex-1" />
              <span className="w-8 tabular-nums text-xs font-medium text-muted-foreground">
                {Math.round(progress)}%
              </span>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex p-4">
          <ResizablePanelGroup orientation="horizontal" className="flex-1">
            <ResizablePanel
              id="result-list"
              defaultSize={36}
              minSize={20}
              className="flex flex-col bg-card rounded-xl border shadow-sm overflow-hidden"
            >
              <ResultTree />
            </ResizablePanel>

            <ResizableHandle className="w-1 bg-transparent hover:bg-primary/10 rounded-full" />

            <ResizablePanel
              id="detail-view"
              defaultSize={64}
              minSize={30}
              className="flex flex-col bg-card rounded-xl border shadow-sm overflow-hidden"
            >
              <DetailPanel />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>

      <div className="flex items-center justify-between px-6 py-2 border-t text-xs text-muted-foreground/70 bg-background select-none">
        <div className="flex items-center gap-3 truncate max-w-[70%]">
          {isScraping ? (
            <>
              <div className="flex items-center gap-2 text-foreground/80 whitespace-nowrap">
                <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                正在处理
              </div>
              <span className="truncate">{currentFilePath}</span>
            </>
          ) : (
            <span className="whitespace-nowrap">就绪</span>
          )}
        </div>
        {statusText && <span className="shrink-0">{statusText}</span>}
      </div>
    </div>
  );
}
