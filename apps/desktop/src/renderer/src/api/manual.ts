import type { CrawlerData } from "@mdcz/shared/types";
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

export const startSelectedScrape = async (filePaths: string[]) => {
  const selectedPaths = filePaths.map((filePath) => filePath.trim()).filter(Boolean);
  if (selectedPaths.length === 0) {
    throw new Error("No files selected");
  }

  const data = await ipc.scraper.start("selection", selectedPaths);
  return { data };
};

export const deleteFile = async (path: string | string[]) => {
  const filePaths = Array.isArray(path) ? path : [path];
  const data = await ipc.file.delete(filePaths);
  return { data };
};

export const deleteFileAndFolder = async (path: string) => {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dir = slash > 0 ? path.slice(0, slash) : path;
  const data = await ipc.file.delete([path, dir]);
  return { data };
};

export const readNfo = async (path: string, videoPath?: string) => {
  const response = await ipc.file.nfoRead(asNfoPath(path), videoPath);
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

export const updateNfo = async (path: string, crawlerData: CrawlerData, videoPath?: string) => {
  const nfoPath = resolveNfoWritePath(path, videoPath);
  const data = await ipc.file.nfoWrite(nfoPath, crawlerData, videoPath);
  return { data };
};

export const retryScrapeSelection = async (_path: string | string[], _options: unknown = {}) => {
  const snapshot = await ipc.scraper.getStatus();
  if (!snapshot) throw new Error("没有可重试的刮削任务");
  if (snapshot.task.status === "running" || snapshot.task.status === "paused" || snapshot.task.status === "stopping") {
    throw new Error("当前刮削任务仍在进行，请等待任务结束后再重试");
  }
  return { data: await ipc.scraper.retry(snapshot.task.id) };
};
