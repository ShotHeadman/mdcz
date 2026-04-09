import type { CrawlerData } from "@shared/types";
import { ipc } from "@/client/ipc";
import { ensureMediaPathConfigured } from "@/client/mediaPath";
import type { ConfigOutput } from "@/client/types";

export interface ScrapeStatusResponse {
  status: "idle" | "running" | "stopping" | "paused";
  progress: number;
  total: number;
  current: number;
  current_path?: string;
}

export interface NfoResponse {
  path: string;
  content: string;
}

export interface RequeueResponse {
  message: string;
  running: boolean;
  queued: number;
  strategy: "new-task" | "requeue";
}

export interface RetryScrapeSelectionOptions {
  scrapeStatus: ScrapeStatusResponse["status"];
  canRequeueCurrentRun?: boolean;
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

const siblingPath = (path: string, name: string): string => {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (slash < 0) {
    return name;
  }

  return `${path.slice(0, slash + 1)}${name}`;
};

const dedupePaths = (paths: string[]): string[] => {
  return [...new Set(paths.filter((value) => value.trim().length > 0))];
};

export const buildNfoReadCandidates = (path: string): string[] => {
  const trimmed = path.trim();
  if (!trimmed) {
    return [];
  }

  const primaryPath = asNfoPath(trimmed);
  if (primaryPath.toLowerCase().endsWith("movie.nfo")) {
    return [primaryPath];
  }

  return dedupePaths([siblingPath(primaryPath, "movie.nfo"), primaryPath]);
};

const shouldRetryWithAlternateNfo = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const code =
    typeof (error as Error & { code?: unknown }).code === "string"
      ? String((error as Error & { code?: unknown }).code)
      : error.name;

  return code === "ENOENT" || code === "ENOTDIR";
};

const toProgress = (completedFiles: number, totalFiles: number): number => {
  if (totalFiles <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, (completedFiles / totalFiles) * 100));
};

const parseCrawlerData = (content: string): CrawlerData => {
  return JSON.parse(content) as CrawlerData;
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

export const getScrapeStatus = async () => {
  const status = await ipc.scraper.getStatus();
  const data: ScrapeStatusResponse = {
    status: status.state,
    progress: toProgress(status.completedFiles, status.totalFiles),
    total: status.totalFiles,
    current: status.completedFiles,
  };
  return { data };
};

export const startBatchScrape = async () => {
  const currentConfig = (await ipc.config.get()) as ConfigOutput;
  const mediaPath = await ensureMediaPathConfigured(currentConfig);
  const data = await ipc.scraper.start("batch", [mediaPath]);
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

export const readNfo = async (path: string) => {
  const candidates = buildNfoReadCandidates(path);
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      const response = await ipc.file.nfoRead(candidate);
      const data: NfoResponse = {
        path: candidate,
        content: JSON.stringify(response.data, null, 2),
      };
      return { data };
    } catch (error) {
      lastError = error;
      if (!shouldRetryWithAlternateNfo(error)) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("NFO path is required");
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

export const updateNfo = async (path: string, content: string, videoPath?: string) => {
  const nfoPath = resolveNfoWritePath(path, videoPath);
  const crawlerData = parseCrawlerData(content);
  const data = await ipc.file.nfoWrite(nfoPath, crawlerData);
  return { data };
};

export const retryScrapeSelection = async (path: string | string[], options: RetryScrapeSelectionOptions) => {
  const filePaths = Array.isArray(path) ? path : [path];

  if (options.scrapeStatus === "idle") {
    const result = await ipc.scraper.retryFailed(filePaths);
    const data: RequeueResponse = {
      message: result.message,
      running: true,
      queued: result.totalFiles,
      strategy: "new-task",
    };
    return { data };
  }

  if (options.scrapeStatus === "running" || options.scrapeStatus === "paused") {
    if (!options.canRequeueCurrentRun) {
      throw new Error("当前刮削任务仍在进行，已成功项目请等待任务结束后再重新刮削");
    }

    const result = await ipc.scraper.requeue(filePaths);
    if (result.requeuedCount <= 0) {
      throw new Error("当前项目不在失败队列中，无法加入当前任务");
    }

    const data: RequeueResponse = {
      message: `已加入当前任务队列，共 ${result.requeuedCount} 个文件`,
      running: true,
      queued: result.requeuedCount,
      strategy: "requeue",
    };
    return { data };
  }

  throw new Error("当前刮削任务正在停止，请等待停止完成后再重新刮削");
};
