import type { MaintenanceApplySelection } from "@mdcz/shared/maintenanceTasks";
import { type LocalFileTarget, parseWireRelativePath } from "@mdcz/shared/mediaRef";
import type { CrawlerData, MaintenancePresetId } from "@mdcz/shared/types";
import type {
  DetailActionPort,
  MaintenanceActionPort,
  ScrapeActionPort,
  SharedWorkbenchPorts,
} from "@mdcz/views/adapters";
import { resolveBatchRescrapeOutput } from "@mdcz/views/adapters";
import { type DetailViewItem, getDetailLocalAssetRef } from "@mdcz/views/detail";
import { readNfo, retryScrapeSelection, updateNfo } from "@/api/manual";
import { ipc } from "@/client/ipc";
import { getImageSrc, getLocalImagePath, resolveImagePath } from "@/utils/image";
import { playMediaPath } from "@/utils/playback";

const dedupeValues = (values: string[]): string[] =>
  values.filter((value, index, items) => value.length > 0 && items.indexOf(value) === index);

const isAbsoluteLocalPath = (value: string): boolean =>
  /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith("/") || value.startsWith("\\\\") || value.startsWith("//");

const toDesktopFileTarget = (path: string, item?: DetailViewItem | null): LocalFileTarget => {
  const normalizedPath = path.replace(/\\/gu, "/");
  const asset = getDetailLocalAssetRef(item, normalizedPath);
  if (asset) return asset;
  if (!item?.fileRef || isAbsoluteLocalPath(path)) {
    return path;
  }

  try {
    return { rootId: item.fileRef.rootId, relativePath: parseWireRelativePath(normalizedPath) };
  } catch {
    return path;
  }
};

const getItemFileTarget = (item: DetailViewItem): LocalFileTarget | undefined => item.fileRef ?? item.path;

export const resolveDesktopImageCandidates = async (
  candidates: string[],
  baseDir?: string,
  item?: DetailViewItem | null,
): Promise<string[]> =>
  dedupeValues(
    await Promise.all(
      candidates.map(async (candidate) => {
        const resolvedPath = getDetailLocalAssetRef(item, candidate) ? candidate : resolveImagePath(candidate, baseDir);
        const directSource = getImageSrc(resolvedPath);
        if (directSource) {
          return directSource;
        }
        const localPath = getLocalImagePath(resolvedPath);
        if (localPath) {
          try {
            const result = await ipc.file.exists(toDesktopFileTarget(localPath, item));
            return result.exists ? (result.url ?? "") : "";
          } catch {
            return "";
          }
        }

        return "";
      }),
    ),
  );

export const createDesktopDetailPort = (): DetailActionPort => ({
  showFilePath: true,
  resolveImageCandidates: resolveDesktopImageCandidates,
  play: (item) => {
    const target = getItemFileTarget(item);
    if (!target) {
      return;
    }
    return playMediaPath(target);
  },
  openFolder: async (item) => {
    const target = getItemFileTarget(item);
    if (!target) {
      return;
    }
    await ipc.app.showItemInFolder(target);
  },
  openMetadataFolder: async (item) => {
    const strm = item.assets?.find((asset) => asset.type === "local" && asset.kind === "strm");
    const target = item.nfoRef ?? (strm?.type === "local" ? strm.file : item.nfoPath);
    if (target) await ipc.app.showItemInFolder(target);
  },
  readNfo: async (item: DetailViewItem, path: string) => {
    const nfoTarget = item.nfoRef && path === item.nfoPath ? item.nfoRef : path;
    const response = await readNfo(nfoTarget, getItemFileTarget(item));
    return {
      path: response.data.path,
      crawlerData: response.data.crawlerData,
    };
  },
  writeNfo: async (item: DetailViewItem, path: string, data: CrawlerData) => {
    await updateNfo(path, data, getItemFileTarget(item));
  },
  preparePosterCrop: async (item) => {
    const target = getItemFileTarget(item);
    if (!target) throw new Error("缺少本地视频路径");
    const session = await ipc.file.posterCropSession(target);
    const source = await ipc.file.exists(session.sourcePath);
    return { ...session, sourceUrl: source.url ?? "" };
  },
  savePosterCrop: async (item, crop) => {
    const target = getItemFileTarget(item);
    if (!target) throw new Error("缺少本地视频路径");
    const result = await ipc.file.posterCropSave(target, crop);
    const poster = await ipc.file.exists(result.targetPath);
    const posterUrl = poster.url ?? "";
    return { posterUrl: posterUrl ? `${posterUrl}?revision=${encodeURIComponent(result.revision)}` : "" };
  },
});

export const createDesktopScrapeActionPort = (): ScrapeActionPort => ({
  rescrapeByUrl: async (targets, manualUrl) => {
    const refs = targets.map((target) => target.ref);
    const first = refs[0];
    if (!first) throw new Error("请选择要刮削的文件");
    const response = await ipc.scraper.start(
      refs.length === 1
        ? { mode: "single", ref: first, manualUrl }
        : { mode: "selection", refs, ...resolveBatchRescrapeOutput(targets), manualUrl },
    );
    return { message: response.message };
  },
  rerunDirectory: async (runId) => {
    await ipc.scraper.rerunDirectory(runId);
  },
  retryFailed: async (itemIds) => {
    const response = await retryScrapeSelection(itemIds);
    return {
      message: response.data.message,
    };
  },
  openFolder: async (target) => {
    await ipc.app.showItemInFolder(target.ref ?? target.filePath);
  },
  play: (target) => playMediaPath(target.ref ?? target.filePath, "播放功能仅在桌面客户端可用", "播放失败"),
  openNfo: (path) => {
    window.dispatchEvent(new CustomEvent("app:open-nfo", { detail: { path } }));
  },
});

export const createDesktopMaintenanceActionPort = (): MaintenanceActionPort => ({
  openFolder: async (filePath) => {
    await ipc.app.showItemInFolder(filePath);
  },
  play: (filePath) => playMediaPath(filePath, "播放功能仅在桌面客户端可用"),
  openNfo: (path) => {
    window.dispatchEvent(new CustomEvent("app:open-nfo", { detail: { path } }));
  },
  rerunDirectory: async (sessionId) => await ipc.maintenance.rerunDirectory(sessionId),
  getActiveSession: () => ipc.maintenance.getActiveSession(),
  updateDraft: async (previewId, draft) => {
    await ipc.maintenance.updateDraft({ previewId, ...draft });
  },
  discardSession: async () => {
    await ipc.maintenance.discardSession();
  },
  preview: async (refs, presetId, targetDir) => {
    const output = targetDir ? await ipc.mediaRoots.prepareOutputDirectory({ hostPath: targetDir }) : undefined;
    return await ipc.maintenance.preview(
      refs,
      presetId,
      output ? { outputRootId: output.id, outputRelativeDirectory: output.relativeDirectory } : undefined,
    );
  },
  execute: async (selections: MaintenanceApplySelection[], presetId: MaintenancePresetId) => {
    await ipc.maintenance.execute(selections, presetId);
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
