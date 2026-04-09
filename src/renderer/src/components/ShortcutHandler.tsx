import { toErrorMessage } from "@shared/error";
import type { RendererShortcutAction } from "@shared/ipcEvents";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import { deleteFile, deleteFileAndFolder, retryScrapeSelection, startBatchScrape, stopScrape } from "@/api/manual";
import { ipc } from "@/client/ipc";
import { buildScrapeResultGroupActionContext, findScrapeResultGroup } from "@/lib/scrapeResultGrouping";
import { useScrapeStore } from "@/store/scrapeStore";
import { useUIStore } from "@/store/uiStore";
import { playMediaPath } from "@/utils/playback";

const WORKBENCH_ONLY_SHORTCUTS = new Set<RendererShortcutAction>([
  "start-or-stop-scrape",
  "retry-scrape",
  "delete-file",
  "delete-file-and-folder",
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
        const selectedGroup = findScrapeResultGroup(scrapeState.results, uiState.selectedResultId);
        const actionContext = selectedGroup
          ? buildScrapeResultGroupActionContext(selectedGroup, uiState.selectedResultId)
          : undefined;
        const selectedItem = actionContext?.selectedItem;
        const selectedNfoPath = actionContext?.nfoPath;
        const groupedVideoPaths = actionContext?.videoPaths ?? [];
        const selectedPath = selectedItem?.fileInfo.filePath;
        const selectedNumber = selectedItem?.fileInfo.number;
        const resetForNewTask = () => {
          scrapeState.clearResults();
          uiState.setSelectedResultId(null);
          scrapeState.updateProgress(0, 0);
          scrapeState.setScraping(true);
          scrapeState.setScrapeStatus("running");
        };
        const handleRetrySelectedScrape = async () => {
          if (!selectedPath) {
            toast.info("请先选择一个结果项");
            return;
          }

          try {
            const response = await retryScrapeSelection(groupedVideoPaths, {
              scrapeStatus: scrapeState.scrapeStatus,
              canRequeueCurrentRun: selectedGroup?.status === "failed",
            });

            if (response.data.strategy === "new-task") {
              resetForNewTask();
            }

            toast.success(response.data.message);
          } catch (error) {
            toast.error(`重试失败: ${toErrorMessage(error)}`);
          }
        };

        switch (action) {
          case "start-or-stop-scrape": {
            if (scrapeState.isScraping) {
              try {
                await stopScrape();
                useScrapeStore.getState().setScrapeStatus("stopping");
                useScrapeStore.getState().setStatusText("正在停止...");
                toast.info("正在停止刮削任务...");
              } catch (error) {
                toast.error(`停止失败: ${toErrorMessage(error)}`);
              }
              return;
            }

            scrapeState.clearResults();
            uiState.setSelectedResultId(null);
            scrapeState.updateProgress(0, 0);
            scrapeState.setScraping(true);
            try {
              const response = await startBatchScrape();
              toast.success(response.data.message);
            } catch (error) {
              scrapeState.setScraping(false);
              toast.error(`启动失败: ${toErrorMessage(error)}`);
            }
            return;
          }

          case "retry-scrape": {
            await handleRetrySelectedScrape();
            return;
          }

          case "delete-file": {
            if (!selectedPath) {
              toast.info("请先选择一个结果项");
              return;
            }
            if (
              !window.confirm(
                groupedVideoPaths.length > 1
                  ? `确定删除当前分组下的 ${groupedVideoPaths.length} 个文件吗？\n${selectedNumber}`
                  : `确定删除文件吗？\n${selectedPath}`,
              )
            ) {
              return;
            }
            try {
              await deleteFile(groupedVideoPaths);
              toast.success(groupedVideoPaths.length > 1 ? `已删除 ${groupedVideoPaths.length} 个文件` : "文件已删除");
            } catch (error) {
              toast.error(`删除失败: ${toErrorMessage(error)}`);
            }
            return;
          }

          case "delete-file-and-folder": {
            if (!selectedPath) {
              toast.info("请先选择一个结果项");
              return;
            }
            if (!window.confirm(`确定删除文件和所在文件夹吗？\n${selectedPath}`)) {
              return;
            }
            try {
              await deleteFileAndFolder(selectedPath);
              toast.success("文件和文件夹已删除");
            } catch (error) {
              toast.error(`删除失败: ${toErrorMessage(error)}`);
            }
            return;
          }

          case "open-folder": {
            if (!selectedPath) {
              toast.info("请先选择一个结果项");
              return;
            }
            if (!window.electron?.openPath) {
              toast.info("仅桌面客户端支持打开目录");
              return;
            }
            const slash = Math.max(selectedPath.lastIndexOf("/"), selectedPath.lastIndexOf("\\"));
            const dir = slash > 0 ? selectedPath.slice(0, slash) : selectedPath;
            void window.electron.openPath(dir);
            return;
          }

          case "play-video": {
            if (!selectedPath) {
              toast.info("请先选择一个结果项");
              return;
            }
            await playMediaPath(selectedPath, "仅桌面客户端支持播放");
            return;
          }

          case "edit-nfo": {
            if (!selectedPath) {
              toast.info("请先选择一个结果项");
              return;
            }
            navigate({ to: "/" });
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
