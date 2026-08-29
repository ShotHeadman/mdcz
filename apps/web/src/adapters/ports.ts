import type { MaintenanceApplySelection } from "@mdcz/shared/maintenanceTasks";
import type { CrawlerData, LocalScanEntry, MaintenancePresetId } from "@mdcz/shared/types";
import type {
  DetailActionPort,
  MaintenanceActionPort,
  ScrapeActionPort,
  SharedWorkbenchPorts,
} from "@mdcz/views/adapters";
import type { DetailViewItem } from "@mdcz/views/detail";
import { useWorkbenchTaskStore } from "@mdcz/views/state/workbenchTaskStore";
import { api, getLibraryAssetSrc } from "../client";
import { requestScrapeLiveRunsRefresh } from "../hooks/useWebTaskSync";

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
  if (item.fileRef) {
    return item.fileRef.relativePath.replace(/\\/gu, "/");
  }
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

const getRootId = (item: DetailViewItem): string => item.fileRef?.rootId ?? item.id.split(":")[0] ?? "";
const getMetadataRootId = (item: DetailViewItem): string => item.nfoRef?.rootId ?? getRootId(item);

const isRemoteImageCandidate = (value: string): boolean => /^(?:https?:\/\/|data:|blob:)/iu.test(value.trim());

const shouldResolveAgainstBaseDir = (candidate: string, item: DetailViewItem): boolean => {
  if (isAbsoluteLocalPath(candidate)) {
    return false;
  }

  const itemRootRelativePath = getRootRelativeItemPath(item);
  const itemRootRelativeDir = getDirName(itemRootRelativePath);
  if (!itemRootRelativeDir) {
    return true;
  }

  return candidate !== itemRootRelativeDir && !candidate.startsWith(`${itemRootRelativeDir}/`);
};

const resolveCandidatePath = (candidate: string, item: DetailViewItem, baseDir?: string): string => {
  const normalizedCandidate = candidate.replace(/\\/gu, "/");
  const normalizedBaseDir = baseDir?.trim().replace(/\\/gu, "/") ?? "";
  if (normalizedBaseDir && shouldResolveAgainstBaseDir(normalizedCandidate, item)) {
    return joinPath(normalizedBaseDir, normalizedCandidate);
  }
  return normalizedCandidate;
};

const toAssetCandidate = (candidate: string, item?: DetailViewItem | null, baseDir?: string): string => {
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

  const normalizedCandidate = trimmed.replace(/\\/gu, "/");
  const asset = item.assets?.find(
    (candidate) =>
      candidate.type === "local" && candidate.file.relativePath.replace(/\\/gu, "/") === normalizedCandidate,
  );
  const rootId = asset?.type === "local" ? asset.file.rootId : getMetadataRootId(item);
  if (!rootId) {
    return trimmed;
  }
  const path = asset?.type === "local" ? asset.file.relativePath : resolveCandidatePath(trimmed, item, baseDir);
  return getLibraryAssetSrc({ rootId, path: toRelativePath(item, path) }) || trimmed;
};

export const createWebDetailPort = (): DetailActionPort => ({
  capabilities: {
    play: "hidden",
    openFolder: "hidden",
    openNfo: "enabled",
    editPoster: "enabled",
  },
  showFilePath: false,
  resolveImageCandidates: async (candidates, baseDir, item) =>
    dedupeValues(candidates.map((candidate) => toAssetCandidate(candidate, item, baseDir))),
  play: () => undefined,
  openFolder: () => undefined,
  readNfo: async (item, path) => {
    const rootId = getMetadataRootId(item);
    const relativePath = toRelativePath(item, path);
    const videoPath = item.outputPath ?? item.path;
    const videoRelativePath = videoPath ? toRelativePath(item, videoPath) : undefined;
    const response = await api.scrape.nfoRead({ rootId, relativePath, videoRelativePath });
    return {
      path: response.effectiveRelativePath,
      crawlerData: response.data as CrawlerData | null,
    };
  },
  writeNfo: async (item, path, data) => {
    const rootId = getMetadataRootId(item);
    const videoPath = item.outputPath ?? item.path;
    const videoRelativePath = videoPath ? toRelativePath(item, videoPath) : undefined;
    await api.scrape.nfoWrite({ rootId, relativePath: toRelativePath(item, path), videoRelativePath, data });
  },
  preparePosterCrop: async (item) => {
    if (!item.resultId) throw new Error("缺少刮削结果标识");
    const response = await api.scrape.posterCropSession({ id: item.resultId });
    return {
      ...response,
      sourceUrl: getLibraryAssetSrc({ rootId: getMetadataRootId(item), path: response.sourceRelativePath }),
    };
  },
  savePosterCrop: async (item, crop) => {
    if (!item.resultId) throw new Error("缺少刮削结果标识");
    const response = await api.scrape.posterCropSave({ id: item.resultId, crop });
    const posterUrl = new URL(
      getLibraryAssetSrc({ rootId: getMetadataRootId(item), path: response.targetRelativePath }),
    );
    if (response.revision) posterUrl.searchParams.set("revision", response.revision);
    return { posterUrl: posterUrl.toString() };
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
    void targets;
    void options;
    const runId = useWorkbenchTaskStore.getState().hydrationState.activeScrapeTaskId;
    if (!runId) throw new Error("没有可重试的刮削任务");
    const retry = await api.scrape.retry({ taskId: runId });
    requestScrapeLiveRunsRefresh();
    return { message: `重试任务已启动：${retry.runId}` };
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
    getActiveSession: async () => await api.maintenance.getActiveSession(),
    updateDraft: async (previewId, draft) => {
      await api.maintenance.updateDraft({ taskId: requireTaskId(), previewId, ...draft });
    },
    discardSession: async () => {
      const taskId = useWorkbenchTaskStore.getState().hydrationState.activeMaintenanceTaskId || undefined;
      await api.maintenance.discardSession(taskId ? { taskId } : undefined);
      useWorkbenchTaskStore.getState().setActiveMaintenanceTaskId("");
    },
    preview: async (entries: LocalScanEntry[], presetId: MaintenancePresetId) => {
      const refs = entries.map((entry) => ({
        rootId: entry.rootRef?.rootId ?? entry.fileId.split(":")[0] ?? "",
        relativePath: entry.rootRef?.relativePath ?? entry.fileInfo.filePath,
      }));
      const rootId = refs[0]?.rootId ?? "";
      const { sessionId } = await api.maintenance.start({ rootId, presetId, refs });
      useWorkbenchTaskStore.getState().setActiveMaintenanceTaskId(sessionId);
      return { sessionId };
    },
    execute: async (selections: MaintenanceApplySelection[]) => {
      const taskId = requireTaskId();
      useWorkbenchTaskStore.getState().setActiveMaintenanceTaskId(taskId);
      await api.maintenance.apply({
        taskId,
        confirmationToken: `maintenance:${taskId}`,
        previewIds: selections.map((selection) => selection.previewId),
        selections,
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
