import type { MaintenanceApplySelection } from "@mdcz/shared/maintenanceTasks";
import { LOCAL_FILE_SCHEME, parseLocalFileUrl } from "@mdcz/shared/mediaRef";
import type { CrawlerData, MaintenancePresetId } from "@mdcz/shared/types";
import type {
  DetailActionPort,
  MaintenanceActionPort,
  ScrapeActionPort,
  SharedWorkbenchPorts,
} from "@mdcz/views/adapters";
import type { DetailViewItem } from "@mdcz/views/detail";
import {
  applyMaintenanceSessionSnapshot,
  selectMaintenanceSessionId,
  useMaintenanceStore,
} from "@mdcz/views/state/maintenanceStore";
import { selectScrapeTaskId, useScrapeStore } from "@mdcz/views/state/scrapeStore";
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
  if (trimmed.startsWith(`${LOCAL_FILE_SCHEME}://`)) {
    const file = parseLocalFileUrl(trimmed);
    return getLibraryAssetSrc({ rootId: file.rootId, path: file.relativePath }) || trimmed;
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
  showFilePath: false,
  resolveImageCandidates: async (candidates, baseDir, item) =>
    dedupeValues(candidates.map((candidate) => toAssetCandidate(candidate, item, baseDir))),
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
  retryFailed: async (itemIds) => {
    const runId = selectScrapeTaskId(useScrapeStore.getState());
    if (!runId) throw new Error("没有可重试的刮削任务");
    const retry = await api.scrape.retry({ taskId: runId, ...(itemIds ? { itemIds: [...itemIds] } : {}) });
    requestScrapeLiveRunsRefresh();
    return { message: `重试任务已启动：${retry.runId}` };
  },
  deleteFile: async (targets) => {
    for (const target of targets) {
      await api.scrape.deleteFile(target.ref);
    }
  },
  openNfo: (path) => {
    window.dispatchEvent(new CustomEvent("app:open-nfo", { detail: { path } }));
  },
});

export const createWebMaintenanceActionPort = (): MaintenanceActionPort => {
  const requireSessionId = () => {
    const activeSessionId = selectMaintenanceSessionId(useMaintenanceStore.getState());
    if (!activeSessionId) {
      throw new Error("当前没有可控制的维护会话");
    }
    return activeSessionId;
  };

  return {
    openNfo: (path) => {
      window.dispatchEvent(new CustomEvent("app:open-nfo", { detail: { path } }));
    },
    getActiveSession: async () => await api.maintenance.getActiveSession(),
    updateDraft: async (previewId, draft) => {
      await api.maintenance.updateDraft({ sessionId: requireSessionId(), previewId, ...draft });
    },
    discardSession: async () => {
      const sessionId = selectMaintenanceSessionId(useMaintenanceStore.getState()) || undefined;
      await api.maintenance.discardSession(sessionId ? { sessionId } : undefined);
      useMaintenanceStore.getState().reset();
    },
    preview: async (refs, presetId: MaintenancePresetId) => {
      const rootId = refs[0]?.rootId ?? "";
      if (!rootId) throw new Error("请选择要维护的文件");
      const { sessionId } = await api.maintenance.start({ rootId, presetId, refs });
      applyMaintenanceSessionSnapshot(await api.maintenance.getActiveSession());
      return { sessionId };
    },
    execute: async (selections: MaintenanceApplySelection[]) => {
      const sessionId = requireSessionId();
      await api.maintenance.execute({
        sessionId,
        confirmationToken: `maintenance:${sessionId}`,
        previewIds: selections.map((selection) => selection.previewId),
        selections,
      });
    },
    pause: async () => {
      await api.maintenance.pause({ sessionId: requireSessionId() });
    },
    resume: async () => {
      await api.maintenance.resume({ sessionId: requireSessionId() });
    },
    stop: async () => {
      await api.maintenance.stop({ sessionId: requireSessionId() });
    },
  };
};

export const createWebWorkbenchPorts = (): SharedWorkbenchPorts => ({
  detail: createWebDetailPort(),
  scrape: createWebScrapeActionPort(),
  maintenance: createWebMaintenanceActionPort(),
});
