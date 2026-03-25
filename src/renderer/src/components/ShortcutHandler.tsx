import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import {
  deleteFile,
  deleteFileAndFolder,
  requeueScrapeByNumber,
  requeueScrapeByUrl,
  startBatchScrape,
  stopScrape,
} from "@/api/manual";
import { ipc } from "@/client/ipc";
import { buildScrapeResultGroupActionContext, findScrapeResultGroup } from "@/lib/scrapeResultGrouping";
import { useScrapeStore } from "@/store/scrapeStore";
import { useUIStore } from "@/store/uiStore";

type ShortcutAction =
  | "start-or-stop-scrape"
  | "search-by-number"
  | "search-by-url"
  | "delete-file"
  | "delete-file-and-folder"
  | "open-folder"
  | "edit-nfo"
  | "play-video";

const WORKBENCH_ONLY_SHORTCUTS = new Set<ShortcutAction>([
  "start-or-stop-scrape",
  "search-by-number",
  "search-by-url",
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

const asMessage = (error: unknown) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
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

      const action = payload.action as ShortcutAction;
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

        switch (action) {
          case "start-or-stop-scrape": {
            if (scrapeState.isScraping) {
              try {
                await stopScrape();
                scrapeState.setScrapeStatus("stopping");
                scrapeState.setStatusText("正在停止...");
                toast.info("正在停止刮削任务...");
              } catch (error) {
                toast.error(`停止失败: ${asMessage(error)}`);
              }
              return;
            }

            scrapeState.clearResults();
            uiState.setSelectedResultId(null);
            scrapeState.updateProgress(0, 0);
            scrapeState.setScraping(true);
            try {
              await startBatchScrape();
              toast.success("刮削任务已启动");
            } catch (error) {
              scrapeState.setScraping(false);
              toast.error(`启动失败: ${asMessage(error)}`);
            }
            return;
          }

          case "search-by-number": {
            if (!selectedItem?.path) {
              toast.info("请先选择一个结果项");
              return;
            }
            navigate({ to: "/" });
            const number = window.prompt("输入番号重新刮削", selectedItem.number || "")?.trim();
            if (!number) {
              return;
            }
            try {
              const response = await requeueScrapeByNumber(groupedVideoPaths, number);
              toast.success(response.data.message);
            } catch (error) {
              toast.error(`重试失败: ${asMessage(error)}`);
            }
            return;
          }

          case "search-by-url": {
            if (!selectedItem?.path) {
              toast.info("请先选择一个结果项");
              return;
            }
            navigate({ to: "/" });
            const url = window.prompt("输入网址重新刮削", "")?.trim();
            if (!url) {
              return;
            }
            try {
              const response = await requeueScrapeByUrl(groupedVideoPaths, url);
              toast.success(response.data.message);
            } catch (error) {
              toast.error(`重试失败: ${asMessage(error)}`);
            }
            return;
          }

          case "delete-file": {
            if (!selectedItem?.path) {
              toast.info("请先选择一个结果项");
              return;
            }
            if (
              !window.confirm(
                groupedVideoPaths.length > 1
                  ? `确定删除当前分组下的 ${groupedVideoPaths.length} 个文件吗？\n${selectedItem.number}`
                  : `确定删除文件吗？\n${selectedItem.path}`,
              )
            ) {
              return;
            }
            try {
              await deleteFile(groupedVideoPaths);
              toast.success(groupedVideoPaths.length > 1 ? `已删除 ${groupedVideoPaths.length} 个文件` : "文件已删除");
            } catch (error) {
              toast.error(`删除失败: ${asMessage(error)}`);
            }
            return;
          }

          case "delete-file-and-folder": {
            if (!selectedItem?.path) {
              toast.info("请先选择一个结果项");
              return;
            }
            if (!window.confirm(`确定删除文件和所在文件夹吗？\n${selectedItem.path}`)) {
              return;
            }
            try {
              await deleteFileAndFolder(selectedItem.path);
              toast.success("文件和文件夹已删除");
            } catch (error) {
              toast.error(`删除失败: ${asMessage(error)}`);
            }
            return;
          }

          case "open-folder": {
            if (!selectedItem?.path) {
              toast.info("请先选择一个结果项");
              return;
            }
            if (!window.electron?.openPath) {
              toast.info("仅桌面客户端支持打开目录");
              return;
            }
            const slash = Math.max(selectedItem.path.lastIndexOf("/"), selectedItem.path.lastIndexOf("\\"));
            const dir = slash > 0 ? selectedItem.path.slice(0, slash) : selectedItem.path;
            void window.electron.openPath(dir);
            return;
          }

          case "play-video": {
            if (!selectedItem?.path) {
              toast.info("请先选择一个结果项");
              return;
            }
            if (!window.electron?.openPath) {
              toast.info("仅桌面客户端支持播放");
              return;
            }
            void window.electron.openPath(selectedItem.path);
            return;
          }

          case "edit-nfo": {
            if (!selectedItem?.path) {
              toast.info("请先选择一个结果项");
              return;
            }
            navigate({ to: "/" });
            window.dispatchEvent(
              new CustomEvent("app:open-nfo", {
                detail: { path: selectedNfoPath ?? selectedItem.path },
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
