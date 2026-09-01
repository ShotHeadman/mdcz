import type { LocalFileTarget, RootFileRef } from "@mdcz/shared/mediaRef";
import type { CrawlerData } from "@mdcz/shared/types";
import { selectScrapeSnapshot, useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { ipc } from "@/client/ipc";

export interface NfoResponse {
  path: string;
  crawlerData: CrawlerData;
}

const asNfoPath = (path: string): string => {
  if (path.toLowerCase().endsWith(".nfo")) {
    return path;
  }
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dot = path.lastIndexOf(".");
  if (dot > idx) {
    return `${path.slice(0, dot)}.nfo`;
  }
  return `${path}.nfo`;
};

const asNfoTarget = (target: LocalFileTarget): LocalFileTarget =>
  typeof target === "string" ? asNfoPath(target) : { ...target, relativePath: asNfoPath(target.relativePath) };

export const stopScrape = async () => {
  const data = await ipc.scraper.stop();
  return { data };
};

export const pauseScrape = async () => {
  const data = await ipc.scraper.pause();
  return { data };
};

export const resumeScrape = async () => {
  const data = await ipc.scraper.resume();
  return { data };
};

export const startSelectedScrape = async (
  refs: RootFileRef[],
  outputRootId: string,
  outputRelativeDirectory?: string,
) => {
  if (refs.length === 0) {
    throw new Error("No files selected");
  }

  const data = await ipc.scraper.start({ mode: "selection", refs, outputRootId, outputRelativeDirectory });
  const snapshot = await ipc.scraper.getStatus(data.taskId);
  if (!snapshot) throw new Error(`Scrape task disappeared after start: ${data.taskId}`);
  useScrapeStore.getState().setSnapshot(snapshot);
  return { data };
};

export const deleteFile = async (target: RootFileRef | RootFileRef[]) => {
  const data = await ipc.file.delete(Array.isArray(target) ? target : [target]);
  if (data.failedCount > 0) throw new Error(`删除失败：${data.failedCount} 个文件未删除`);
  return { data };
};

export const deleteFileAndFolder = async (target: RootFileRef) => {
  const data = await ipc.file.delete([target], true);
  if (data.failedCount > 0) throw new Error("删除文件夹失败");
  return { data };
};

export const readNfo = async (path: LocalFileTarget, videoPath?: LocalFileTarget) => {
  const response = await ipc.file.nfoRead(asNfoTarget(path), videoPath);
  const data: NfoResponse = {
    path: response.nfoPath,
    crawlerData: response.data,
  };
  return { data };
};

export const resolveNfoWritePath = (path: string, videoPath?: string): string => {
  const nfoPath = asNfoPath(path);
  if (!nfoPath.toLowerCase().endsWith("movie.nfo")) {
    return nfoPath;
  }

  const normalizedVideoPath = videoPath?.trim();
  if (!normalizedVideoPath) {
    return nfoPath;
  }

  return asNfoPath(normalizedVideoPath);
};

export const updateNfo = async (path: LocalFileTarget, crawlerData: CrawlerData, videoPath?: LocalFileTarget) => {
  const nfoPath =
    typeof path === "string"
      ? resolveNfoWritePath(path, typeof videoPath === "string" ? videoPath : undefined)
      : asNfoTarget(path);
  const data = await ipc.file.nfoWrite(nfoPath, crawlerData, videoPath);
  return { data };
};

export const retryScrapeSelection = async (itemIds?: readonly string[]) => {
  const snapshot = selectScrapeSnapshot(useScrapeStore.getState());
  if (!snapshot) throw new Error("没有可重试的刮削任务");
  if (
    snapshot.task.status === "queued" ||
    snapshot.task.status === "running" ||
    snapshot.task.status === "paused" ||
    snapshot.task.status === "stopping"
  ) {
    throw new Error("当前刮削任务仍在进行，请等待任务结束后再重试");
  }
  return {
    data: itemIds ? await ipc.scraper.retry(snapshot.task.id, itemIds) : await ipc.scraper.retry(snapshot.task.id),
  };
};
