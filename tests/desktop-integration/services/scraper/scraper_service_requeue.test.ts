import { writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { configManager, configurationSchema, defaultConfiguration } from "@main/services/config";
import { SignalService } from "@main/services/SignalService";
import type { FileScraperDependencies } from "@main/services/scraper/FileScraper";
import * as FileScraperModule from "@main/services/scraper/FileScraper";
import { FileScraper } from "@main/services/scraper/FileScraper";
import { ScraperService } from "@main/services/scraper/ScraperService";
import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import { NetworkClient } from "@mdcz/runtime/network";
import { AggregationService } from "@mdcz/runtime/scrape";
import { Website } from "@mdcz/shared/enums";
import type { ScrapeResult } from "@mdcz/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTempDirectory, type TempDirectoryHarness } from "../../../harness/tempDirectory";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const waitFor = async (predicate: () => boolean, timeoutMs = 1000): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }

  throw new Error("Timed out waiting for scraper state");
};

const waitForIdle = async (service: ScraperService): Promise<void> => {
  await service.waitForIdle();
  await waitFor(() => !service.getStatus().running, 2000);
};

const tempDirs: TempDirectoryHarness[] = [];

const createTempDir = async (): Promise<string> => {
  const directory = await createTempDirectory("scraper-requeue");
  tempDirs.push(directory);
  return directory.path;
};

const createService = (): ScraperService => {
  const networkClient = new NetworkClient();
  return new ScraperService(
    new SignalService(null),
    networkClient,
    new CrawlerProvider({ fetchGateway: new FetchGateway(networkClient) }),
  );
};

const mockConfig = () => {
  const config = configurationSchema.parse({
    ...defaultConfiguration,
    scrape: { ...defaultConfiguration.scrape, threadNumber: 1 },
  });
  vi.spyOn(configManager, "ensureLoaded").mockResolvedValue(undefined);
  vi.spyOn(configManager, "get").mockResolvedValue(config);
  return config;
};

const scrapeResult = (
  filePath: string,
  website: NonNullable<ScrapeResult["crawlerData"]>["website"],
  status: "success" | "failed" = "success",
): ScrapeResult => {
  const fileName = basename(filePath);
  const number = fileName.slice(0, -extname(fileName).length);
  const fileInfo = { filePath, fileName, extension: ".mp4", number, isSubtitled: false };
  return status === "failed"
    ? { status, fileId: number.toLowerCase(), error: "lookup failed", fileInfo }
    : {
        status,
        fileId: number.toLowerCase(),
        fileInfo,
        crawlerData: { title: number, number, actors: [], genres: [], scene_images: [], website },
      };
};

describe("ScraperService requeue flow", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempDirs.splice(0, tempDirs.length).map((directory) => directory.cleanup()));
  });

  it("rejects duplicate retry queue entries for the same failed file", async () => {
    const service = createService();
    const config = mockConfig();
    const dirPath = await createTempDir();
    const secondFileTask = deferred<ScrapeResult>();
    const firstFilePath = join(dirPath, "ABP-111.mp4");
    const secondFilePath = join(dirPath, "ABP-222.mp4");
    let firstFileAttempts = 0;

    await writeFile(firstFilePath, "video", "utf8");
    await writeFile(secondFilePath, "video", "utf8");

    vi.spyOn(FileScraper.prototype, "scrapeFile").mockImplementation((filePath) => {
      if (filePath === firstFilePath) {
        firstFileAttempts += 1;
        return Promise.resolve(
          scrapeResult(firstFilePath, config.scrape.sites[0], firstFileAttempts === 1 ? "failed" : "success"),
        );
      }

      if (filePath === secondFilePath) {
        return secondFileTask.promise;
      }

      throw new Error(`Unexpected file path: ${filePath}`);
    });

    await service.retryFiles([firstFilePath, secondFilePath]);
    await waitFor(() => service.getFailedFiles().includes(firstFilePath) && service.getStatus().running);

    await expect(service.requeue([firstFilePath])).resolves.toEqual({ requeuedCount: 1 });
    await expect(service.requeue([firstFilePath])).resolves.toEqual({ requeuedCount: 0 });

    secondFileTask.resolve(scrapeResult(secondFilePath, config.scrape.sites[0]));

    await waitForIdle(service);

    expect(firstFileAttempts).toBe(2);
    expect(service.getFailedFiles()).toEqual([]);
    expect(service.getStatus()).toMatchObject({
      failedCount: 0,
      successCount: 2,
      completedFiles: 2,
      state: "idle",
      running: false,
    });
  });

  it("does not advance retry progress numbering when an earlier file is already retrying", async () => {
    const service = createService();
    const config = mockConfig();
    const dirPath = await createTempDir();
    const thirdFileTask = deferred<ScrapeResult>();
    const fourthFileTask = deferred<ScrapeResult>();
    const firstFilePath = join(dirPath, "ABP-311.mp4");
    const secondFilePath = join(dirPath, "ABP-322.mp4");
    const thirdFilePath = join(dirPath, "ABP-333.mp4");
    const fourthFilePath = join(dirPath, "ABP-344.mp4");
    const attemptCounts = new Map<string, number>();
    const retryProgress = new Map<string, number[]>();

    for (const filePath of [firstFilePath, secondFilePath, thirdFilePath, fourthFilePath]) {
      await writeFile(filePath, "video", "utf8");
    }

    vi.spyOn(FileScraper.prototype, "scrapeFile").mockImplementation((filePath, progress) => {
      const attempt = (attemptCounts.get(filePath) ?? 0) + 1;
      attemptCounts.set(filePath, attempt);

      if (attempt > 1) {
        if (typeof progress?.fileIndex !== "number") {
          throw new Error(`Missing retry progress for ${filePath}`);
        }
        const values = retryProgress.get(filePath) ?? [];
        values.push(progress.fileIndex);
        retryProgress.set(filePath, values);
      }

      if (filePath === firstFilePath) {
        return Promise.resolve(
          scrapeResult(firstFilePath, config.scrape.sites[0], attempt === 1 ? "failed" : "success"),
        );
      }

      if (filePath === secondFilePath) {
        return Promise.resolve(
          scrapeResult(secondFilePath, config.scrape.sites[0], attempt === 1 ? "failed" : "success"),
        );
      }

      if (filePath === thirdFilePath) {
        return thirdFileTask.promise;
      }

      if (filePath === fourthFilePath) {
        return fourthFileTask.promise;
      }

      throw new Error(`Unexpected file path: ${filePath}`);
    });

    await service.retryFiles([firstFilePath, secondFilePath, thirdFilePath, fourthFilePath]);
    await waitFor(
      () =>
        service.getFailedFiles().includes(firstFilePath) &&
        service.getFailedFiles().includes(secondFilePath) &&
        service.getStatus().running,
    );

    await expect(service.requeue([firstFilePath])).resolves.toEqual({ requeuedCount: 1 });
    await expect(service.requeue([firstFilePath, secondFilePath])).resolves.toEqual({ requeuedCount: 1 });

    thirdFileTask.resolve(scrapeResult(thirdFilePath, config.scrape.sites[0]));
    fourthFileTask.resolve(scrapeResult(fourthFilePath, config.scrape.sites[0]));

    await waitForIdle(service);

    expect(retryProgress.get(secondFilePath)).toEqual([3]);
  });

  it("reuses the same aggregation service for requeues and clears its cache when the session ends", async () => {
    const service = createService();
    const config = mockConfig();
    const secondFileTask = deferred<ScrapeResult>();
    const firstFilePath = "/tmp/ABP-911.mp4";
    const secondFilePath = "/tmp/ABP-922.mp4";
    const createdDependencies: FileScraperDependencies[] = [];
    const attemptCounts = new Map<string, number>();

    const clearCacheSpy = vi.spyOn(AggregationService.prototype, "clearCache");
    vi.spyOn(FileScraperModule, "createFileScraper").mockImplementation((deps) => {
      createdDependencies.push(deps);

      return {
        scrapeFile: (filePath: string) => {
          const attempt = (attemptCounts.get(filePath) ?? 0) + 1;
          attemptCounts.set(filePath, attempt);

          if (filePath === firstFilePath) {
            return Promise.resolve(
              scrapeResult(firstFilePath, config.scrape.sites[0], attempt === 1 ? "failed" : "success"),
            );
          }

          if (filePath === secondFilePath) {
            return secondFileTask.promise;
          }

          throw new Error(`Unexpected file path: ${filePath}`);
        },
      } as unknown as FileScraper;
    });

    await service.retryFiles([firstFilePath, secondFilePath]);
    await waitFor(() => service.getFailedFiles().includes(firstFilePath) && service.getStatus().running);

    await expect(service.requeue([firstFilePath])).resolves.toEqual({ requeuedCount: 1 });

    secondFileTask.resolve(scrapeResult(secondFilePath, config.scrape.sites[0]));

    await waitForIdle(service);

    expect(createdDependencies).toHaveLength(2);
    expect(createdDependencies[0]?.aggregationService).toBe(createdDependencies[1]?.aggregationService);
    expect(clearCacheSpy).toHaveBeenCalledTimes(1);
  });

  it("passes manual scrape options to retry file tasks", async () => {
    const service = createService();
    mockConfig();
    const dirPath = await createTempDir();
    const filePath = join(dirPath, "ABP-123.mp4");
    const manualScrape = {
      site: Website.DMM_TV,
      detailUrl: "https://video.dmm.co.jp/av/content/?id=1abp00123",
    };

    await writeFile(filePath, "video", "utf8");

    const scrapeFile = vi
      .spyOn(FileScraper.prototype, "scrapeFile")
      .mockResolvedValue(scrapeResult(filePath, Website.DMM_TV));

    await service.retryFiles([filePath], manualScrape);
    await waitForIdle(service);

    expect(scrapeFile).toHaveBeenCalledWith(filePath, { fileIndex: 1, totalFiles: 1 }, expect.anything(), {
      manualScrape,
    });
  });
});
