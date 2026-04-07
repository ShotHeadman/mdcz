import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configManager, configurationSchema, defaultConfiguration } from "@main/services/config";
import { CrawlerProvider, FetchGateway } from "@main/services/crawler";
import { NetworkClient } from "@main/services/network";
import { SignalService } from "@main/services/SignalService";
import { AggregationService } from "@main/services/scraper/aggregation";
import type { FileScraperDependencies } from "@main/services/scraper/FileScraper";
import * as FileScraperModule from "@main/services/scraper/FileScraper";
import { FileScraper } from "@main/services/scraper/FileScraper";
import { ScraperService } from "@main/services/scraper/ScraperService";
import type { ScrapeResult } from "@shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  await waitFor(() => !service.getStatus().running, 2000);
};

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-scraper-requeue-"));
  tempDirs.push(dirPath);
  return dirPath;
};

describe("ScraperService requeue flow", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map((dirPath) => rm(dirPath, { recursive: true, force: true })),
    );
  });

  it("rejects duplicate retry queue entries for the same failed file", async () => {
    const signalService = new SignalService(null);
    const networkClient = new NetworkClient();
    const crawlerProvider = new CrawlerProvider({
      fetchGateway: new FetchGateway(networkClient),
    });
    const service = new ScraperService(signalService, networkClient, crawlerProvider);
    const config = configurationSchema.parse({
      ...defaultConfiguration,
      scrape: {
        ...defaultConfiguration.scrape,
        threadNumber: 1,
      },
    });
    const dirPath = await createTempDir();
    const secondFileTask = deferred<ScrapeResult>();
    const firstFilePath = join(dirPath, "ABP-111.mp4");
    const secondFilePath = join(dirPath, "ABP-222.mp4");
    let firstFileAttempts = 0;

    await writeFile(firstFilePath, "video", "utf8");
    await writeFile(secondFilePath, "video", "utf8");

    vi.spyOn(configManager, "ensureLoaded").mockResolvedValue(undefined);
    vi.spyOn(configManager, "get").mockResolvedValue(config);
    vi.spyOn(FileScraper.prototype, "scrapeFile").mockImplementation((filePath) => {
      if (filePath === firstFilePath) {
        firstFileAttempts += 1;
        if (firstFileAttempts === 1) {
          return Promise.resolve({
            status: "failed",
            fileId: "abp-111",
            error: "lookup failed",
            fileInfo: {
              filePath: firstFilePath,
              fileName: "ABP-111.mp4",
              extension: ".mp4",
              number: "ABP-111",
              isSubtitled: false,
            },
          });
        }

        return Promise.resolve({
          status: "success",
          fileId: "abp-111",
          fileInfo: {
            filePath: firstFilePath,
            fileName: "ABP-111.mp4",
            extension: ".mp4",
            number: "ABP-111",
            isSubtitled: false,
          },
          crawlerData: {
            title: "ABP-111",
            number: "ABP-111",
            actors: [],
            genres: [],
            scene_images: [],
            website: config.scrape.enabledSites[0],
          },
        });
      }

      if (filePath === secondFilePath) {
        return secondFileTask.promise;
      }

      throw new Error(`Unexpected file path: ${filePath}`);
    });

    await service.start("batch", [dirPath]);
    await waitFor(() => service.getFailedFiles().includes(firstFilePath) && service.getStatus().running);

    await expect(service.requeue([firstFilePath])).resolves.toEqual({ requeuedCount: 1 });
    await expect(service.requeue([firstFilePath])).resolves.toEqual({ requeuedCount: 0 });

    secondFileTask.resolve({
      status: "success",
      fileId: "abp-222",
      fileInfo: {
        filePath: secondFilePath,
        fileName: "ABP-222.mp4",
        extension: ".mp4",
        number: "ABP-222",
        isSubtitled: false,
      },
      crawlerData: {
        title: "ABP-222",
        number: "ABP-222",
        actors: [],
        genres: [],
        scene_images: [],
        website: config.scrape.enabledSites[0],
      },
    });

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
    const signalService = new SignalService(null);
    const networkClient = new NetworkClient();
    const crawlerProvider = new CrawlerProvider({
      fetchGateway: new FetchGateway(networkClient),
    });
    const service = new ScraperService(signalService, networkClient, crawlerProvider);
    const config = configurationSchema.parse({
      ...defaultConfiguration,
      scrape: {
        ...defaultConfiguration.scrape,
        threadNumber: 1,
      },
    });
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

    vi.spyOn(configManager, "ensureLoaded").mockResolvedValue(undefined);
    vi.spyOn(configManager, "get").mockResolvedValue(config);
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
        if (attempt === 1) {
          return Promise.resolve({
            status: "failed",
            fileId: "abp-311",
            error: "lookup failed",
            fileInfo: {
              filePath: firstFilePath,
              fileName: "ABP-311.mp4",
              extension: ".mp4",
              number: "ABP-311",
              isSubtitled: false,
            },
          });
        }

        return Promise.resolve({
          status: "success",
          fileId: "abp-311",
          fileInfo: {
            filePath: firstFilePath,
            fileName: "ABP-311.mp4",
            extension: ".mp4",
            number: "ABP-311",
            isSubtitled: false,
          },
          crawlerData: {
            title: "ABP-311",
            number: "ABP-311",
            actors: [],
            genres: [],
            scene_images: [],
            website: config.scrape.enabledSites[0],
          },
        });
      }

      if (filePath === secondFilePath) {
        if (attempt === 1) {
          return Promise.resolve({
            status: "failed",
            fileId: "abp-322",
            error: "lookup failed",
            fileInfo: {
              filePath: secondFilePath,
              fileName: "ABP-322.mp4",
              extension: ".mp4",
              number: "ABP-322",
              isSubtitled: false,
            },
          });
        }

        return Promise.resolve({
          status: "success",
          fileId: "abp-322",
          fileInfo: {
            filePath: secondFilePath,
            fileName: "ABP-322.mp4",
            extension: ".mp4",
            number: "ABP-322",
            isSubtitled: false,
          },
          crawlerData: {
            title: "ABP-322",
            number: "ABP-322",
            actors: [],
            genres: [],
            scene_images: [],
            website: config.scrape.enabledSites[0],
          },
        });
      }

      if (filePath === thirdFilePath) {
        return thirdFileTask.promise;
      }

      if (filePath === fourthFilePath) {
        return fourthFileTask.promise;
      }

      throw new Error(`Unexpected file path: ${filePath}`);
    });

    await service.start("batch", [dirPath]);
    await waitFor(
      () =>
        service.getFailedFiles().includes(firstFilePath) &&
        service.getFailedFiles().includes(secondFilePath) &&
        service.getStatus().running,
    );

    await expect(service.requeue([firstFilePath])).resolves.toEqual({ requeuedCount: 1 });
    await expect(service.requeue([firstFilePath, secondFilePath])).resolves.toEqual({ requeuedCount: 1 });

    thirdFileTask.resolve({
      status: "success",
      fileId: "abp-333",
      fileInfo: {
        filePath: thirdFilePath,
        fileName: "ABP-333.mp4",
        extension: ".mp4",
        number: "ABP-333",
        isSubtitled: false,
      },
      crawlerData: {
        title: "ABP-333",
        number: "ABP-333",
        actors: [],
        genres: [],
        scene_images: [],
        website: config.scrape.enabledSites[0],
      },
    });
    fourthFileTask.resolve({
      status: "success",
      fileId: "abp-344",
      fileInfo: {
        filePath: fourthFilePath,
        fileName: "ABP-344.mp4",
        extension: ".mp4",
        number: "ABP-344",
        isSubtitled: false,
      },
      crawlerData: {
        title: "ABP-344",
        number: "ABP-344",
        actors: [],
        genres: [],
        scene_images: [],
        website: config.scrape.enabledSites[0],
      },
    });

    await waitForIdle(service);

    expect(retryProgress.get(secondFilePath)).toEqual([3]);
  });

  it("reuses the same aggregation service for requeues and clears its cache when the session ends", async () => {
    const signalService = new SignalService(null);
    const networkClient = new NetworkClient();
    const crawlerProvider = new CrawlerProvider({
      fetchGateway: new FetchGateway(networkClient),
    });
    const service = new ScraperService(signalService, networkClient, crawlerProvider);
    const config = configurationSchema.parse({
      ...defaultConfiguration,
      scrape: {
        ...defaultConfiguration.scrape,
        threadNumber: 1,
      },
    });
    const secondFileTask = deferred<ScrapeResult>();
    const firstFilePath = "/tmp/ABP-911.mp4";
    const secondFilePath = "/tmp/ABP-922.mp4";
    const createdDependencies: FileScraperDependencies[] = [];
    const attemptCounts = new Map<string, number>();

    vi.spyOn(configManager, "ensureLoaded").mockResolvedValue(undefined);
    vi.spyOn(configManager, "get").mockResolvedValue(config);
    const clearCacheSpy = vi.spyOn(AggregationService.prototype, "clearCache");
    vi.spyOn(FileScraperModule, "createFileScraper").mockImplementation((deps) => {
      createdDependencies.push(deps);

      return {
        scrapeFile: (filePath: string) => {
          const attempt = (attemptCounts.get(filePath) ?? 0) + 1;
          attemptCounts.set(filePath, attempt);

          if (filePath === firstFilePath) {
            if (attempt === 1) {
              return Promise.resolve({
                status: "failed",
                fileId: "abp-911",
                error: "lookup failed",
                fileInfo: {
                  filePath: firstFilePath,
                  fileName: "ABP-911.mp4",
                  extension: ".mp4",
                  number: "ABP-911",
                  isSubtitled: false,
                },
              });
            }

            return Promise.resolve({
              status: "success",
              fileId: "abp-911",
              fileInfo: {
                filePath: firstFilePath,
                fileName: "ABP-911.mp4",
                extension: ".mp4",
                number: "ABP-911",
                isSubtitled: false,
              },
              crawlerData: {
                title: "ABP-911",
                number: "ABP-911",
                actors: [],
                genres: [],
                scene_images: [],
                website: config.scrape.enabledSites[0],
              },
            });
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

    secondFileTask.resolve({
      status: "success",
      fileId: "abp-922",
      fileInfo: {
        filePath: secondFilePath,
        fileName: "ABP-922.mp4",
        extension: ".mp4",
        number: "ABP-922",
        isSubtitled: false,
      },
      crawlerData: {
        title: "ABP-922",
        number: "ABP-922",
        actors: [],
        genres: [],
        scene_images: [],
        website: config.scrape.enabledSites[0],
      },
    });

    await waitForIdle(service);

    expect(createdDependencies).toHaveLength(2);
    expect(createdDependencies[0]?.aggregationService).toBe(createdDependencies[1]?.aggregationService);
    expect(clearCacheSpy).toHaveBeenCalledTimes(1);
  });
});
