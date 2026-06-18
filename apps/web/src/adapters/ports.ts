import { maintenancePreviewDtoToPreviewItem } from "@mdcz/shared/dtoAdapters";
import { useWorkbenchTaskStore } from "@mdcz/shared/stores/workbenchTaskStore";
import type { CrawlerData, LocalScanEntry, MaintenanceCommitItem, MaintenancePresetId } from "@mdcz/shared/types";
import type {
  DetailActionPort,
  MaintenanceActionPort,
  ScrapeActionPort,
  SharedWorkbenchPorts,
} from "@mdcz/views/adapters";
import type { DetailViewItem } from "@mdcz/views/detail";
import { api, getLibraryAssetSrc } from "../client";

const dedupeValues = (values: string[]): string[] =>
  values
    .map((value) => value.trim())
    .filter((value, index, items) => value.length > 0 && items.indexOf(value) === index);

const isAbsoluteLocalPath = (value: string): boolean =>
  /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith("/") || value.startsWith("\\\\") || value.startsWith("//");

const getDirName = (path: string): string => {
  const normalized = path.replace(/[\\/]+$/u, "");
  const slash = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return slash >= 0 ? normalized.slice(0, slash) : "";
};

const joinPath = (left: string, right: string): string => {
  const normalizedLeft = left.replace(/[\\/]+$/u, "");
  const normalizedRight = right.replace(/^[\\/]+/u, "");
  if (!normalizedLeft) {
    return normalizedRight;
  }
  if (!normalizedRight) {
    return normalizedLeft;
  }
  return `${normalizedLeft}/${normalizedRight}`;
};

const getRootRelativeItemPath = (item: DetailViewItem): string => {
  const [_rootId, ...relativeParts] = item.id.split(":");
  return relativeParts.join(":").replace(/\\/gu, "/");
};

const inferRootHostPath = (item: DetailViewItem): string => {
  const itemPath = item.path?.replace(/\\/gu, "/") ?? "";
  const rootRelativePath = getRootRelativeItemPath(item);
  if (!itemPath || !rootRelativePath) {
    return "";
  }
  if (itemPath === rootRelativePath) {
    return "";
  }
  if (itemPath.endsWith(`/${rootRelativePath}`)) {
    return itemPath.slice(0, -(rootRelativePath.length + 1));
  }
  return "";
};

const toRelativePath = (item: DetailViewItem, path: string): string => {
  const normalizedPath = path.replace(/\\/gu, "/");
  if (!isAbsoluteLocalPath(normalizedPath)) {
    return normalizedPath;
  }

  const rootHostPath = inferRootHostPath(item);
  if (rootHostPath && normalizedPath.startsWith(`${rootHostPath}/`)) {
    return normalizedPath.slice(rootHostPath.length + 1);
  }

  const itemPath = item.path?.replace(/\\/gu, "/") ?? "";
  const itemDir = getDirName(itemPath);
  if (itemDir && normalizedPath.startsWith(`${itemDir}/`)) {
    return joinPath(getDirName(getRootRelativeItemPath(item)), normalizedPath.slice(itemDir.length + 1));
  }

  return normalizedPath;
};

const getRootId = (item: DetailViewItem): string => item.id.split(":")[0] || "";

const isRemoteImageCandidate = (value: string): boolean => /^(?:https?:\/\/|data:|blob:)/iu.test(value.trim());

const toAssetCandidate = (candidate: string, item?: DetailViewItem | null): string => {
  const trimmed = candidate.trim();
  if (!trimmed) {
    return "";
  }
  if (isRemoteImageCandidate(trimmed)) {
    return trimmed;
  }
  if (!item) {
    return trimmed;
  }

  const rootId = getRootId(item);
  if (!rootId) {
    return trimmed;
  }
  return getLibraryAssetSrc({ rootId, path: toRelativePath(item, trimmed) }) || trimmed;
};

export const createWebDetailPort = (): DetailActionPort => ({
  capabilities: {
    play: "hidden",
    openFolder: "hidden",
    openNfo: "enabled",
  },
  resolveImageCandidates: async (candidates, _baseDir, item) =>
    dedupeValues(candidates.map((candidate) => toAssetCandidate(candidate, item))),
  play: () => undefined,
  openFolder: () => undefined,
  readNfo: async (item, path) => {
    const rootId = getRootId(item);
    const relativePath = toRelativePath(item, path);
    const response = await api.scrape.nfoRead({ rootId, relativePath });
    return {
      path: response.relativePath,
      crawlerData: response.data as CrawlerData | null,
    };
  },
  writeNfo: async (item, path, data) => {
    const rootId = getRootId(item);
    await api.scrape.nfoWrite({ rootId, relativePath: toRelativePath(item, path), data });
  },
});

export const createWebScrapeActionPort = (): ScrapeActionPort => ({
  capabilities: {
    deleteFile: "enabled",
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
    const task = await api.scrape.start({
      refs: refs as NonNullable<(typeof refs)[number]>[],
      manualUrl: options.manualUrl,
    });
    useWorkbenchTaskStore.getState().setActiveScrapeTaskId(task.id);
    return { message: `重试任务已启动，共 ${refs.length} 个文件`, strategy: "new-task" };
  },
  getDeleteFileAvailability: (targets) =>
    targets.length > 0 && targets.every((target) => target.ref) ? "enabled" : "hidden",
  deleteFile: async (targets) => {
    const refs = targets.map((target) => target.ref);
    if (refs.some((ref) => !ref)) {
      throw new Error("Web 删除文件需要媒体目录引用，请从工作台重新扫描后再试。");
    }
    for (const ref of refs as NonNullable<(typeof refs)[number]>[]) {
      await api.scrape.deleteFile(ref);
    }
  },
  deleteFileAndFolder: async (filePath) => {
    void filePath;
    throw new Error("Web 端不支持删除服务器主机文件夹");
  },
  openFolder: () => undefined,
  play: () => undefined,
  openNfo: (path) => {
    window.dispatchEvent(new CustomEvent("app:open-nfo", { detail: { path } }));
  },
});

export const createWebMaintenanceActionPort = (): MaintenanceActionPort => {
  const requireTaskId = () => {
    const activeTaskId = useWorkbenchTaskStore.getState().hydrationState.activeMaintenanceTaskId;
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
      useWorkbenchTaskStore.getState().setActiveMaintenanceTaskId(task.id);
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
      useWorkbenchTaskStore.getState().setActiveMaintenanceTaskId(taskId);
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
