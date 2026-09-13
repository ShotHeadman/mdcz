import { toErrorMessage } from "@mdcz/shared/error";
import type { RendererShortcutAction } from "@mdcz/shared/ipcEvents";
import {
  buildScrapeResultGroupActionContext,
  findScrapeResultGroup,
} from "@mdcz/shared/viewModels/scrapeResultGrouping";
import { activateNewScrapeTask } from "@mdcz/views/adapters";
import { selectMaintenanceExecutionStatus, useMaintenanceStore } from "@mdcz/views/state/maintenanceStore";
import { runScrapeRequest, selectIsScraping, selectScrapeResults, useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { useUIStore } from "@mdcz/views/state/uiStore";
import { useWorkbenchSetupStore } from "@mdcz/views/state/workbenchSetupStore";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import { retryScrapeSelection, startSelectedScrape, stopScrape } from "@/api/manual";
import { ipc } from "@/client/ipc";
import { playMediaPath } from "@/utils/playback";

const WORKBENCH_ONLY_SHORTCUTS = new Set<RendererShortcutAction>([
  "start-or-stop-scrape",
  "retry-scrape",
  "open-folder",
  "edit-nfo",
  "play-video",
]);

const isEditingText = () => {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) {
    return false;
  }
  if (active.isContentEditable) {
    return true;
  }
  return ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);
};

export function ShortcutHandler() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;

  useEffect(() => {
    const unsubscribe = ipc.on.shortcut((payload) => {
      if (isEditingText()) {
        return;
      }

      const action = payload.action;
      const uiState = useUIStore.getState();

      if (WORKBENCH_ONLY_SHORTCUTS.has(action) && (pathname !== "/" || uiState.workbenchMode !== "scrape")) {
        return;
      }

      void (async () => {
        const scrapeState = useScrapeStore.getState();
        const results = selectScrapeResults(scrapeState);
        const selectedGroup = findScrapeResultGroup(results, uiState.selectedResultId);
        const actionContext = selectedGroup
          ? buildScrapeResultGroupActionContext(selectedGroup, uiState.selectedResultId)
          : undefined;
        const selectedItem = actionContext?.selectedItem;
        const selectedNfoPath = actionContext?.nfoPath;
        const selectedPath = selectedItem
          ? (selectedItem.output?.relativePath ?? selectedItem.relativePath)
          : undefined;
        const selectedRef = selectedItem
          ? (selectedItem.output ?? { rootId: selectedItem.rootId, relativePath: selectedItem.relativePath })
          : undefined;
        const handleRetrySelectedScrape = async () => {
          if (!selectedItem) {
            toast.info("请先选择一个结果项");
            return;
          }

          try {
            const response = await retryScrapeSelection([selectedItem.fileId]);
            toast.success(response.data.message);
          } catch (error) {
            toast.error(`重试失败: ${toErrorMessage(error)}`);
          }
        };

        switch (action) {
          case "start-or-stop-scrape": {
            if (selectIsScraping(scrapeState)) {
              try {
                await runScrapeRequest(stopScrape);
                toast.info("正在停止刮削任务...");
              } catch (error) {
                toast.error(`停止失败: ${toErrorMessage(error)}`);
              }
              return;
            }

            try {
              const maintenanceBusy = selectMaintenanceExecutionStatus(useMaintenanceStore.getState()) !== "idle";
              if (maintenanceBusy) {
                toast.warning("维护模式正在运行中，无法启动正常刮削。请先停止当前维护任务。");
                return;
              }

              const workbenchSetupState = useWorkbenchSetupStore.getState();
              if (workbenchSetupState.scanStatus === "scanning") {
                toast.info("目录仍在扫描中，请稍候再试");
                return;
              }

              if (workbenchSetupState.scanStatus === "error") {
                toast.info("当前目录扫描失败，请先重新扫描");
                return;
              }

              if (!workbenchSetupState.scanDir.trim()) {
                toast.info("请先选择扫描目录");
                return;
              }

              if (workbenchSetupState.selectedPaths.length === 0) {
                toast.info("请先选择至少一个文件");
                return;
              }

              const selectedCandidates = workbenchSetupState.candidates.filter((candidate) =>
                workbenchSetupState.selectedPaths.includes(candidate.path),
              );
              if (selectedCandidates.length === 0) {
                toast.info("请先选择至少一个文件");
                return;
              }

              if (!workbenchSetupState.targetDir.trim()) {
                toast.info("请先选择输出目录");
                return;
              }
              const outputRoot = await ipc.mediaRoots.prepareOutputDirectory({
                hostPath: workbenchSetupState.targetDir,
              });
              activateNewScrapeTask();
              const response = await startSelectedScrape(
                selectedCandidates.map((candidate) => candidate.ref),
                outputRoot.id,
                outputRoot.relativeDirectory,
              );
              toast.success(response.data.message);
            } catch (error) {
              const errorMessage = toErrorMessage(error);
              if (errorMessage.includes("NO_FILES")) {
                toast.info("当前目录中没有需要刮削的媒体文件");
                return;
              }

              toast.error(`启动失败: ${errorMessage}`);
            }
            return;
          }

          case "retry-scrape": {
            await handleRetrySelectedScrape();
            return;
          }

          case "open-folder": {
            if (!selectedPath) {
              toast.info("请先选择一个结果项");
              return;
            }
            const slash = Math.max(selectedPath.lastIndexOf("/"), selectedPath.lastIndexOf("\\"));
            const dir = slash > 0 ? selectedPath.slice(0, slash) : selectedPath;
            void ipc.app.showItemInFolder(selectedRef ?? dir);
            return;
          }

          case "play-video": {
            if (!selectedPath) {
              toast.info("请先选择一个结果项");
              return;
            }
            await playMediaPath(selectedRef ?? selectedPath, "仅桌面客户端支持播放");
            return;
          }

          case "edit-nfo": {
            if (!selectedPath) {
              toast.info("请先选择一个结果项");
              return;
            }
            navigate({ to: "/workbench" });
            window.dispatchEvent(
              new CustomEvent("app:open-nfo", {
                detail: { path: selectedNfoPath ?? selectedPath },
              }),
            );
            return;
          }

          default:
            return;
        }
      })();
    });

    return unsubscribe;
  }, [navigate, pathname]);

  return null;
}
