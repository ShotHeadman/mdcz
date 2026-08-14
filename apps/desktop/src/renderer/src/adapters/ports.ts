import type { CrawlerData, MaintenanceCommitItem, MaintenancePresetId } from "@mdcz/shared/types";
import type {
  DetailActionPort,
  MaintenanceActionPort,
  ScrapeActionPort,
  SharedWorkbenchPorts,
} from "@mdcz/views/adapters";
import type { DetailViewItem } from "@mdcz/views/detail";
import { deleteFile, deleteFileAndFolder, readNfo, retryScrapeSelection, updateNfo } from "@/api/manual";
import { ipc } from "@/client/ipc";
import { getImageSrc, getLocalImagePath, resolveImagePath } from "@/utils/image";
import { getDirFromPath } from "@/utils/path";
import { playMediaPath } from "@/utils/playback";

const dedupeValues = (values: string[]): string[] =>
  values.filter((value, index, items) => value.length > 0 && items.indexOf(value) === index);

export const resolveDesktopImageCandidates = async (candidates: string[], baseDir?: string): Promise<string[]> =>
  dedupeValues(
    await Promise.all(
      candidates.map(async (candidate) => {
        const localPath = getLocalImagePath(candidate, baseDir);
        if (localPath) {
          try {
            const { exists } = await ipc.file.exists(localPath);
            return exists ? getImageSrc(localPath) : "";
          } catch {
            return "";
          }
        }

        return getImageSrc(resolveImagePath(candidate, baseDir));
      }),
    ),
  );

export const createDesktopDetailPort = (): DetailActionPort => ({
  capabilities: {
    play: "enabled",
    openFolder: "enabled",
    openNfo: "enabled",
    editPoster: "enabled",
  },
  showFilePath: true,
  resolveImageCandidates: resolveDesktopImageCandidates,
  play: (item) => {
    if (!item.path) {
      return;
    }
    return playMediaPath(item.path);
  },
  openFolder: (item) => {
    if (!item.path) {
      return;
    }
    if (window.electron?.openPath) {
      window.electron.openPath(getDirFromPath(item.path));
    }
  },
  readNfo: async (_item: DetailViewItem, path: string) => {
    const response = await readNfo(path, _item.path);
    return {
      path: response.data.path,
      crawlerData: response.data.crawlerData,
    };
  },
  writeNfo: async (item: DetailViewItem, path: string, data: CrawlerData) => {
    await updateNfo(path, data, item.path);
  },
  preparePosterCrop: async (item) => {
    if (!item.path) throw new Error("缺少本地视频路径");
    const session = await ipc.file.posterCropSession(item.path);
    return { ...session, sourceUrl: getImageSrc(session.sourcePath) };
  },
  savePosterCrop: async (item, crop) => {
    if (!item.path) throw new Error("缺少本地视频路径");
    const result = await ipc.file.posterCropSave(item.path, crop);
    return { posterUrl: `${getImageSrc(result.targetPath)}?revision=${encodeURIComponent(result.revision)}` };
  },
});

export const createDesktopScrapeActionPort = (): ScrapeActionPort => ({
  capabilities: {
    deleteFile: "enabled",
    deleteFileAndFolder: "enabled",
    openFolder: "enabled",
    play: "enabled",
    openNfo: "enabled",
  },
  retrySelection: async (targets, options) => {
    const filePaths = targets.map((target) => target.filePath);
    const response = await retryScrapeSelection(filePaths, options);
    return {
      message: response.data.message,
      strategy: response.data.strategy,
    };
  },
  deleteFile: async (targets) => {
    const filePaths = targets.map((target) => target.filePath);
    await deleteFile(filePaths);
  },
  deleteFileAndFolder: async (filePath) => {
    await deleteFileAndFolder(filePath);
  },
  openFolder: async (filePath) => {
    await ipc.app.showItemInFolder(filePath);
  },
  play: (filePath) => playMediaPath(filePath, "播放功能仅在桌面客户端可用", "播放失败"),
  openNfo: (path) => {
    window.dispatchEvent(new CustomEvent("app:open-nfo", { detail: { path } }));
  },
});

export const createDesktopMaintenanceActionPort = (): MaintenanceActionPort => ({
  capabilities: {
    openFolder: "enabled",
    play: "enabled",
    openNfo: "enabled",
  },
  openFolder: async (filePath) => {
    await ipc.app.showItemInFolder(filePath);
  },
  play: (filePath) => playMediaPath(filePath, "播放功能仅在桌面客户端可用"),
  openNfo: (path) => {
    window.dispatchEvent(new CustomEvent("app:open-nfo", { detail: { path } }));
  },
  scanFiles: (filePaths) => ipc.maintenance.scanFiles(filePaths),
  preview: (entries, presetId) => ipc.maintenance.preview(entries, presetId),
  execute: async (commitItems: MaintenanceCommitItem[], presetId: MaintenancePresetId) => {
    await ipc.maintenance.execute(commitItems, presetId);
  },
  pause: async () => {
    await ipc.maintenance.pause();
  },
  resume: async () => {
    await ipc.maintenance.resume();
  },
  stop: async () => {
    await ipc.maintenance.stop();
  },
});

export const createDesktopWorkbenchPorts = (): SharedWorkbenchPorts => ({
  detail: createDesktopDetailPort(),
  scrape: createDesktopScrapeActionPort(),
  maintenance: createDesktopMaintenanceActionPort(),
});
