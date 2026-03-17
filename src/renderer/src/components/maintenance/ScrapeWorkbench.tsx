import { DetailPanel } from "@/components/DetailPanel";
import { ResultTree } from "@/components/ResultTree";
import { Progress } from "@/components/ui/Progress";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/Resizable";
import { useScrapeStore } from "@/store/scrapeStore";

export default function ScrapeWorkbench() {
  const { isScraping, progress, currentFilePath, statusText } = useScrapeStore();

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col">
        {isScraping && (
          <div className="px-8 pt-4 pb-0">
            <div className="bg-card rounded-lg p-1 border flex items-center gap-4">
              <Progress value={progress} className="h-2 flex-1 ml-3" />
              <span className="text-[10px] font-bold text-primary w-12 tabular-nums">{Math.round(progress)}%</span>
            </div>
          </div>
        )}

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

      <div className="flex items-center justify-between px-8 py-3 border-t text-xs font-medium text-muted-foreground bg-background">
        <div className="flex items-center gap-4 truncate max-w-[70%]">
          {isScraping && (
            <div className="flex items-center gap-2 text-primary animate-pulse">
              <div className="h-1.5 w-1.5 rounded-full bg-current" />
              正在处理
            </div>
          )}
          <span className="truncate opacity-70 text-xs">{currentFilePath || "就绪"}</span>
        </div>
        {statusText && <span className="px-2 py-0.5 bg-muted rounded text-xs shrink-0">{statusText}</span>}
      </div>
    </div>
  );
}
