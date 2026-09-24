import { toErrorMessage } from "@mdcz/shared/error";
import type { RendererShortcutAction } from "@mdcz/shared/ipcEvents";
import {
  buildScrapeResultGroupActionContext,
  findScrapeResultGroup,
} from "@mdcz/shared/viewModels/scrapeResultGrouping";
import { runScrapeRequest, selectIsScraping, selectScrapeResults, useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { useUIStore } from "@mdcz/views/state/uiStore";
import { useWorkbenchSetupStore } from "@mdcz/views/state/workbenchSetupStore";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import { retryScrapeSelection, stopScrape } from "@/api/manual";
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

      if (WORKBENCH_ONLY_SHORTCUTS.has(action) && (pathname !== "/workbench" || uiState.workbenchMode !== "scrape")) {
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
              await useWorkbenchSetupStore.getState().startTask?.();
            } catch (error) {
              toast.error(`启动失败: ${toErrorMessage(error)}`);
            }
            return;
          }

          case "retry-scrape": {
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
