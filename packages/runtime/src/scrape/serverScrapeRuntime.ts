import path from "node:path";
import type { CrawlerData } from "@mdcz/shared/types";
import { isVideoFileName } from "@mdcz/shared/videoClassification";
import {
  atomicWriteRootFile,
  listRootFiles,
  type MediaRoot,
  readRootFile,
  StorageError,
  storageErrorCodes,
} from "@mdcz/storage";
import { buildPlaceholderCrawlerData, type NfoGenerator, parseNfo } from "./nfo";

export interface RuntimeScrapeFileRef {
  root: MediaRoot;
  relativePath: string;
  manualUrl?: string | null;
}

export interface RuntimeScrapeItemSuccess {
  status: "success";
  crawlerData: CrawlerData;
  nfoRelativePath: string;
  outputRelativePath: string;
  size: number;
  modifiedAt: Date | null;
}

export interface RuntimeScrapeItemFailure {
  status: "failed";
  error: string;
}

export type RuntimeScrapeItemResult = RuntimeScrapeItemSuccess | RuntimeScrapeItemFailure;

export class RuntimeScrapeProcessor {
  constructor(private readonly nfoGenerator: NfoGenerator) {}

  async scrapePlaceholder(input: RuntimeScrapeFileRef): Promise<RuntimeScrapeItemResult> {
    try {
      const files = await listRootFiles(input.root, path.posix.dirname(input.relativePath), false);
      const file = files.find((item) => item.relativePath === input.relativePath);
      if (!isVideoFileName(path.posix.basename(input.relativePath))) {
        throw new Error("不是支持的视频文件");
      }

      const crawlerData = buildPlaceholderCrawlerData(input.relativePath, input.manualUrl);
      const nfoRelativePath = toNfoRelativePath(input.relativePath);
      await atomicWriteRootFile(input.root, nfoRelativePath, this.nfoGenerator.buildXml(crawlerData));

      return {
        status: "success",
        crawlerData,
        nfoRelativePath,
        outputRelativePath: input.relativePath,
        size: file?.size ?? 0,
        modifiedAt: file?.modifiedAt ?? null,
      };
    } catch (error) {
      return {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async readNfo(
    root: MediaRoot,
    relativePath: string,
  ): Promise<{ exists: false; data: null } | { exists: true; data: CrawlerData }> {
    const content = await readRootFile(root, relativePath).catch((error: unknown) => {
      if (error instanceof StorageError && error.code === storageErrorCodes.MissingPath) {
        return null;
      }
      throw error;
    });
    return content === null
      ? { exists: false, data: null }
      : { exists: true, data: parseNfo(content.toString("utf-8"), relativePath) };
  }

  async writeNfo(root: MediaRoot, relativePath: string, data: CrawlerData): Promise<void> {
    await atomicWriteRootFile(root, relativePath, this.nfoGenerator.buildXml(data));
  }
}

export const toNfoRelativePath = (relativePath: string): string => {
  const parsed = path.posix.parse(relativePath);
  return path.posix.join(parsed.dir, `${parsed.name}.nfo`);
};
