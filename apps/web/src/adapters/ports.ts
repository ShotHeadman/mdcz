import type {
  DetailActionPort,
  MaintenanceActionPort,
  ScrapeActionPort,
  SharedWorkbenchPorts,
} from "@mdcz/shared/adapters";
import { maintenancePreviewDtoToPreviewItem } from "@mdcz/shared/dtoAdapters";
import type { CrawlerData, LocalScanEntry, MaintenanceCommitItem, MaintenancePresetId } from "@mdcz/shared/types";
import type { DetailViewItem } from "@mdcz/views/detail";
import { api } from "../client";

const toRelativePath = (item: DetailViewItem, path: string): string => {
  const normalizedPath = path.replace(/\\/gu, "/");
  const itemPath = item.path?.replace(/\\/gu, "/") ?? "";
  const rootRelative = itemPath.split("/").slice(0, -1).join("/");
  if (rootRelative && normalizedPath.startsWith(`${rootRelative}/`)) {
    return normalizedPath.slice(rootRelative.length + 1);
  }
  return normalizedPath;
};

export const createWebDetailPort = (): DetailActionPort => ({
  capabilities: {
    play: "hidden",
    openFolder: "hidden",
    openNfo: "enabled",
  },
  play: () => undefined,
  openFolder: () => undefined,
  readNfo: async (item, path) => {
    const rootId = item.id.split(":")[0] || "";
    const relativePath = toRelativePath(item, path);
    const response = await api.scrape.nfoRead({ rootId, relativePath });
    return {
      path: response.relativePath,
      crawlerData: response.data as CrawlerData | null,
    };
  },
  writeNfo: async (item, path, data) => {
    const rootId = item.id.split(":")[0] || "";
    await api.scrape.nfoWrite({ rootId, relativePath: toRelativePath(item, path), data });
  },
});

export const createWebScrapeActionPort = (): ScrapeActionPort => ({
  capabilities: {
    deleteFile: "hidden",
    deleteFileAndFolder: "hidden",
    openFolder: "hidden",
    play: "hidden",
    openNfo: "enabled",
  },
  retrySelection: async (targets, options) => {
    const refs = targets.map((target) => target.ref);
    if (refs.some((ref) => !ref)) {
      throw new Error("Web 重试需要媒体目录引用，请从工作台重新扫描后启动。");
    }
    await api.scrape.start({
      refs: refs as NonNullable<(typeof refs)[number]>[],
      manualUrl: options.manualUrl,
    });
    return { message: "刮削任务已提交", strategy: "new-task" };
  },
  deleteFile: async (filePaths) => {
    void filePaths;
    throw new Error("Web 端暂不支持直接删除主机文件");
  },
  deleteFileAndFolder: async (filePath) => {
    void filePath;
    throw new Error("Web 端暂不支持直接删除主机文件夹");
  },
  openFolder: () => undefined,
  play: () => undefined,
  openNfo: (path) => {
    window.dispatchEvent(new CustomEvent("app:open-nfo", { detail: { path } }));
  },
});

export const createWebMaintenanceActionPort = (): MaintenanceActionPort => {
  let activeTaskId = "";
  const requireTaskId = () => {
    if (!activeTaskId) {
      throw new Error("当前没有可控制的维护任务");
    }
    return activeTaskId;
  };

  return {
    capabilities: {
      openFolder: "hidden",
      play: "hidden",
      openNfo: "enabled",
    },
    openFolder: () => undefined,
    play: () => undefined,
    openNfo: (path) => {
      window.dispatchEvent(new CustomEvent("app:open-nfo", { detail: { path } }));
    },
    scanFiles: async (filePaths, context) => {
      if (!context?.scanDir) {
        throw new Error("Web 维护扫描需要扫描目录");
      }
      return await api.maintenance.scanSelectedFiles({ filePaths, scanDir: context.scanDir });
    },
    preview: async (entries: LocalScanEntry[], presetId: MaintenancePresetId) => {
      const refs = entries.map((entry) => ({
        rootId: entry.rootRef?.rootId ?? entry.fileId.split(":")[0] ?? "",
        relativePath: entry.rootRef?.relativePath ?? entry.fileInfo.filePath,
      }));
      const rootId = refs[0]?.rootId ?? "";
      const task = await api.maintenance.start({ rootId, presetId, refs });
      activeTaskId = task.id;
      const preview = await api.maintenance.preview({ taskId: task.id });
      return {
        items: preview.items.map(maintenancePreviewDtoToPreviewItem),
      };
    },
    execute: async (commitItems: MaintenanceCommitItem[], _presetId: MaintenancePresetId, context) => {
      const selectedFileIds = new Set(commitItems.map((item) => item.entry.fileId));
      const previews = Object.values(context?.previewResults ?? {}).filter((preview) =>
        selectedFileIds.has(preview.fileId),
      );
      const previewIds = previews.map((preview) => preview.previewId).filter((id): id is string => Boolean(id));
      if (previewIds.length === 0) {
        throw new Error("没有可应用的维护预览");
      }
      const taskIds = new Set(
        previews.map((preview) => preview.taskId).filter((taskId): taskId is string => Boolean(taskId)),
      );
      if (taskIds.size !== 1) {
        throw new Error("维护预览缺少任务 ID");
      }
      const taskId = [...taskIds][0];
      activeTaskId = taskId;
      await api.maintenance.apply({
        taskId,
        confirmationToken: `maintenance:${taskId}`,
        previewIds,
        selections: previews
          .map((preview) => {
            if (!preview.previewId) {
              return null;
            }
            return {
              previewId: preview.previewId,
              fieldSelections: context?.fieldSelections[preview.fileId],
            };
          })
          .filter((selection): selection is NonNullable<typeof selection> => Boolean(selection)),
      });
    },
    pause: async () => {
      await api.maintenance.pause({ taskId: requireTaskId() });
    },
    resume: async () => {
      await api.maintenance.resume({ taskId: requireTaskId() });
    },
    stop: async () => {
      await api.maintenance.stop({ taskId: requireTaskId() });
    },
  };
};

export const createWebWorkbenchPorts = (): SharedWorkbenchPorts => ({
  detail: createWebDetailPort(),
  scrape: createWebScrapeActionPort(),
  maintenance: createWebMaintenanceActionPort(),
});
