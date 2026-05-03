import path from "node:path";
import type { Configuration } from "@mdcz/shared/config";
import { validateManualScrapeUrl } from "@mdcz/shared/manualScrapeUrl";
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
import type { AggregationService, ManualScrapeOptions } from "./aggregation";
import { inferNumber, type NfoGenerator, parseNfo } from "./nfo";

export interface RuntimeScrapeFileRef {
  root: MediaRoot;
  relativePath: string;
  manualUrl?: string | null;
  config?: Configuration;
  signal?: AbortSignal;
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
  constructor(
    private readonly nfoGenerator: NfoGenerator,
    private readonly aggregationService?: AggregationService,
  ) {}

  async scrape(input: RuntimeScrapeFileRef): Promise<RuntimeScrapeItemResult> {
    try {
      const files = await listRootFiles(input.root, path.posix.dirname(input.relativePath), false);
      const file = files.find((item) => item.relativePath === input.relativePath);
      if (!isVideoFileName(path.posix.basename(input.relativePath))) {
        throw new Error("不是支持的视频文件");
      }

      const crawlerData = await this.resolveCrawlerData(input);
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

  private async resolveCrawlerData(input: RuntimeScrapeFileRef): Promise<CrawlerData> {
    const existingNfo = await this.readNfo(input.root, toNfoRelativePath(input.relativePath));
    if (existingNfo.exists) {
      return existingNfo.data;
    }

    if (!this.aggregationService) {
      throw new Error("刮削运行时未配置 crawler provider，无法从站点获取元数据");
    }
    if (!input.config) {
      throw new Error("刮削运行时缺少配置，无法执行 crawler 聚合");
    }

    const manualScrape = this.resolveManualScrape(input.manualUrl);
    const result = await this.aggregationService.aggregate(
      inferNumber(input.relativePath),
      input.config,
      input.signal,
      manualScrape,
    );
    if (!result) {
      throw new Error("未从启用站点获取到可用元数据");
    }
    return result.data;
  }

  private resolveManualScrape(manualUrl?: string | null): ManualScrapeOptions | undefined {
    const trimmed = manualUrl?.trim();
    if (!trimmed) {
      return undefined;
    }

    const validation = validateManualScrapeUrl(trimmed);
    if (!validation.valid) {
      throw new Error(validation.message);
    }
    return {
      site: validation.route.site,
      detailUrl: validation.route.detailUrl,
    };
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
