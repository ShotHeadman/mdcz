import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { LayoutDashboard, PauseCircle, Play, StopCircle } from "lucide-react";
import { lazy, Suspense } from "react";
import { toast } from "sonner";
import { pauseScrape, resumeScrape, startBatchScrape, stopScrape } from "@/api/manual";
import { getCurrentConfig } from "@/client/api";
import type { ConfigOutput } from "@/client/types";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/Button";
import { TabButton } from "@/components/ui/TabButton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import { useMaintenanceStore } from "@/store/maintenanceStore";
import { useScrapeStore } from "@/store/scrapeStore";
import { useUIStore } from "@/store/uiStore";

const ScrapeWorkbench = lazy(() => import("@/components/maintenance/ScrapeWorkbench"));
const MaintenanceWorkbench = lazy(() => import("@/components/maintenance/MaintenanceWorkbench"));

export const Route = createFileRoute("/")({
  component: Index,
});

function DisabledModeButton({ label, tooltip, active }: { label: string; tooltip: string; active: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <TabButton isActive={active} disabled className="h-9 rounded-lg px-5 text-sm">
            {label}
          </TabButton>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function Index() {
  const configQ = useQuery({
    queryKey: ["config", "current"],
    queryFn: async () => {
      const response = await getCurrentConfig({ throwOnError: true });
      return response.data as ConfigOutput;
    },
  });

  const { isScraping, scrapeStatus, setScraping, setScrapeStatus, updateProgress, setStatusText, clearResults } =
    useScrapeStore((state) => ({
      isScraping: state.isScraping,
      scrapeStatus: state.scrapeStatus,
      setScraping: state.setScraping,
      setScrapeStatus: state.setScrapeStatus,
      updateProgress: state.updateProgress,
      setStatusText: state.setStatusText,
      clearResults: state.clearResults,
    }));
  const maintenanceStatus = useMaintenanceStore((state) => state.executionStatus);
  const { workbenchMode, setWorkbenchMode, setSelectedResultId } = useUIStore((state) => ({
    workbenchMode: state.workbenchMode,
    setWorkbenchMode: state.setWorkbenchMode,
    setSelectedResultId: state.setSelectedResultId,
  }));

  const maintenanceBusy = maintenanceStatus !== "idle";

  const handleStartScrape = async () => {
    if (maintenanceBusy) {
      toast.warning("维护模式正在运行中，无法启动正常刮削。请先停止当前维护任务。");
      return;
    }

    try {
      clearResults();
      setSelectedResultId(null);
      updateProgress(0, 0);
      setScraping(true);
      await startBatchScrape();
      toast.success("刮削任务已启动");
    } catch (_error) {
      toast.error("启动失败");
      setScraping(false);
    }
  };

  const handleStopScrape = async () => {
    if (!window.confirm("确定要停止刮削吗？")) return;
    try {
      await stopScrape();
      setScrapeStatus("stopping");
      setStatusText("正在停止...");
      toast.info("正在停止...");
    } catch (_error) {
      toast.error("停止失败");
    }
  };

  const handlePauseScrape = async () => {
    try {
      await pauseScrape();
      setScrapeStatus("paused");
      setStatusText("已暂停");
      toast.info("任务已暂停");
    } catch (_error) {
      toast.error("暂停失败");
    }
  };

  const handleResumeScrape = async () => {
    try {
      await resumeScrape();
      setScrapeStatus("running");
      setStatusText("已恢复");
      toast.success("任务已恢复");
    } catch (_error) {
      toast.error("恢复失败");
    }
  };

  const pageExtra =
    workbenchMode === "scrape" ? (
      <>
        {isScraping && scrapeStatus !== "stopping" && (
          <Button
            variant="outline"
            onClick={scrapeStatus === "paused" ? handleResumeScrape : handlePauseScrape}
            className="h-9 rounded-lg px-5"
          >
            {scrapeStatus === "paused" ? (
              <>
                <Play className="mr-2 h-4 w-4" /> 恢复任务
              </>
            ) : (
              <>
                <PauseCircle className="mr-2 h-4 w-4" /> 暂停任务
              </>
            )}
          </Button>
        )}
        <Button
          variant={isScraping ? "destructive" : "default"}
          onClick={isScraping ? handleStopScrape : handleStartScrape}
          className="h-9 rounded-lg px-6 font-semibold shadow-sm"
        >
          {isScraping ? (
            <>
              <StopCircle className="mr-2 h-4 w-4" /> 停止任务
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" /> 开始刮削
            </>
          )}
        </Button>
      </>
    ) : undefined;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PageHeader
        title="工作台"
        icon={LayoutDashboard}
        subtitle={
          configQ.data?.paths?.mediaPath ? (
            <span className="flex items-baseline gap-1">
              当前目录:
              <code className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono">
                {configQ.data.paths.mediaPath}
              </code>
            </span>
          ) : (
            "尚未配置媒体目录"
          )
        }
        extra={pageExtra}
      />

      <div className="px-8 pb-2 border-b bg-background/60 backdrop-blur-md">
        <div className="flex items-center gap-2">
          {maintenanceBusy ? (
            <DisabledModeButton
              label="正常刮削"
              tooltip="维护模式执行中，暂时不能切换到正常刮削。"
              active={workbenchMode === "scrape"}
            />
          ) : (
            <TabButton
              isActive={workbenchMode === "scrape"}
              className="h-9 rounded-lg px-5 text-sm"
              onClick={() => setWorkbenchMode("scrape")}
            >
              正常刮削
            </TabButton>
          )}

          {isScraping ? (
            <DisabledModeButton
              label="维护模式"
              tooltip="正常刮削执行中，暂时不能切换到维护模式。"
              active={workbenchMode === "maintenance"}
            />
          ) : (
            <TabButton
              isActive={workbenchMode === "maintenance"}
              className="h-9 rounded-lg px-5 text-sm"
              onClick={() => setWorkbenchMode("maintenance")}
            >
              维护模式
            </TabButton>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载中...</div>
          }
        >
          {workbenchMode === "scrape" ? (
            <ScrapeWorkbench />
          ) : (
            <MaintenanceWorkbench mediaPath={configQ.data?.paths?.mediaPath} />
          )}
        </Suspense>
      </div>
    </div>
  );
}
