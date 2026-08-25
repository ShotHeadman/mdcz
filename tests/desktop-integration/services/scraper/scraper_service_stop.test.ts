import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configManager, configurationSchema, defaultConfiguration } from "@main/services/config";
import type { OutputLibraryScanner } from "@main/services/library";
import { SignalService } from "@main/services/SignalService";
import { FileScraper } from "@main/services/scraper/FileScraper";
import { ScraperService } from "@main/services/scraper/ScraperService";
import { createAbortError } from "@main/utils/abort";
import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import { NetworkClient } from "@mdcz/runtime/network";
import { AggregationService } from "@mdcz/runtime/scrape";
import type { ScrapeResult } from "@mdcz/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryDesktopScrapeExecutionAdapter } from "./MemoryDesktopScrapeExecutionAdapter";

const tempDirs: string[] = [];

const createTempMediaFile = async (fileName: string): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-scraper-stop-"));
  tempDirs.push(dirPath);
  const filePath = join(dirPath, fileName);
  await writeFile(filePath, "video");
  return filePath;
};

class CaptureSignalService extends SignalService {
  readonly buttonStatusEvents: Array<{ startEnabled: boolean; stopEnabled: boolean }> = [];

  override setButtonStatus(startEnabled: boolean, stopEnabled: boolean): void {
    this.buttonStatusEvents.push({ startEnabled, stopEnabled });
    super.setButtonStatus(startEnabled, stopEnabled);
  }
}

const withResolvers = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const deferred = <T>() => withResolvers<T>();

const createService = (
  signalService = new CaptureSignalService(null),
  executionStore = new MemoryDesktopScrapeExecutionAdapter(),
) => {
  const networkClient = new NetworkClient();
  const crawlerProvider = new CrawlerProvider({ fetchGateway: new FetchGateway(networkClient) });
  return {
    executionStore,
    signalService,
    service: new ScraperService(
      signalService,
      networkClient,
      crawlerProvider,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      executionStore,
    ),
  };
};

const mockConfig = (config = configurationSchema.parse(defaultConfiguration)) => {
  vi.spyOn(configManager, "ensureLoaded").mockResolvedValue(undefined);
  vi.spyOn(configManager, "get").mockResolvedValue(config);
  return config;
};

const successResult = (
  filePath: string,
  number: string,
  website: NonNullable<ScrapeResult["crawlerData"]>["website"],
): ScrapeResult => ({
  status: "success",
  fileId: number.toLowerCase(),
  fileInfo: {
    filePath,
    fileName: `${number}.mp4`,
    extension: ".mp4",
    number,
    isSubtitled: false,
  },
  crawlerData: {
    title: number,
    number,
    actors: [],
    genres: [],
    scene_images: [],
    website,
  },
});

const abortableScrape = (_filePath: string, _progress: unknown, signal?: AbortSignal) => {
  const { promise, reject } = withResolvers<ScrapeResult>();
  if (signal?.aborted) {
    reject(createAbortError());
    return promise;
  }

  signal?.addEventListener(
    "abort",
    () => {
      reject(createAbortError());
    },
    { once: true },
  );
  return promise;
};

describe("ScraperService stop flow", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map((dirPath) => rm(dirPath, { recursive: true, force: true })),
    );
    vi.restoreAllMocks();
  });

  it("aborts active work, commits skipped outcomes, and finalizes stopped", async () => {
    const { executionStore, signalService, service } = createService();
    mockConfig();
    const mediaFilePath = await createTempMediaFile("ABP-123.mp4");
    vi.spyOn(FileScraper.prototype, "scrapeFile").mockImplementation(abortableScrape);

    await service.startSingle([mediaFilePath]);
    await expect(service.stop()).resolves.toEqual({ pendingCount: 1 });

    expect(service.getStatus().running).toBe(false);
    expect(executionStore.committed.map(({ result }) => result.status)).toEqual(["skipped"]);
    expect(executionStore.finalized).toMatchObject([{ disposition: "stopped", skippedCount: 1 }]);
    expect(signalService.buttonStatusEvents).toEqual([
      { startEnabled: false, stopEnabled: true },
      { startEnabled: false, stopEnabled: false },
      { startEnabled: true, stopEnabled: false },
    ]);
  });

  it("commits each result before finalizing and invalidating the output summary", async () => {
    const events: string[] = [];
    const signalService = new CaptureSignalService(null);
    const executionStore = new MemoryDesktopScrapeExecutionAdapter();
    const commitItem = executionStore.commitItem.bind(executionStore);
    const finalizeRun = executionStore.finalizeRun.bind(executionStore);
    vi.spyOn(executionStore, "commitItem").mockImplementation(async (...args) => {
      events.push(`commit:${args[2].status}`);
      return await commitItem(...args);
    });
    vi.spyOn(executionStore, "finalizeRun").mockImplementation(async (...args) => {
      events.push(`finalize:${args[1]}`);
      return await finalizeRun(...args);
    });
    const outputLibraryScanner = {
      invalidate: vi.fn(() => {
        events.push("invalidate");
      }),
    } as unknown as OutputLibraryScanner;
    const networkClient = new NetworkClient();
    const crawlerProvider = new CrawlerProvider({ fetchGateway: new FetchGateway(networkClient) });
    const service = new ScraperService(
      signalService,
      networkClient,
      crawlerProvider,
      undefined,
      undefined,
      undefined,
      outputLibraryScanner,
      undefined,
      executionStore,
    );
    const config = mockConfig();
    const mediaFilePath = await createTempMediaFile("ABP-789.mp4");

    vi.spyOn(AggregationService.prototype, "clearCache").mockImplementation(() => {
      events.push("clear-cache");
    });
    vi.spyOn(FileScraper.prototype, "scrapeFile").mockResolvedValue(
      successResult(mediaFilePath, "ABP-789", config.scrape.sites[0]),
    );

    await service.startSingle([mediaFilePath]);
    await service.waitForIdle();

    expect(executionStore.committed).toMatchObject([
      {
        result: {
          status: "success",
          crawlerData: { number: "ABP-789" },
        },
      },
    ]);
    expect(executionStore.finalized).toMatchObject([{ disposition: "completed", successCount: 1 }]);
    expect(outputLibraryScanner.invalidate).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["commit:success", "finalize:completed", "invalidate", "clear-cache"]);
  });

  it("pauses after the active result settles and resumes remaining admission", async () => {
    const { signalService, service } = createService();
    const config = mockConfig();
    const runningTask = deferred<ScrapeResult>();
    const mediaFilePath = await createTempMediaFile("ABP-456.mp4");
    vi.spyOn(FileScraper.prototype, "scrapeFile").mockImplementation(() => runningTask.promise);

    await service.startSingle([mediaFilePath]);
    const pause = service.pause();
    expect(service.getStatus().state).toBe("paused");
    runningTask.resolve(successResult(mediaFilePath, "ABP-456", config.scrape.sites[0]));
    await pause;
    expect(service.getStatus().state).toBe("paused");

    await service.resume();
    await service.waitForIdle();
    expect(service.getStatus().state).toBe("idle");
    expect(signalService.buttonStatusEvents.at(-1)).toEqual({ startEnabled: true, stopEnabled: false });
  });

  it("stops without admitting an item blocked behind the rest gate", async () => {
    const { service } = createService();
    mockConfig(
      configurationSchema.parse({
        ...defaultConfiguration,
        scrape: { ...defaultConfiguration.scrape, threadNumber: 2, restAfterCount: 1, restDuration: 60 },
      }),
    );
    const firstPath = "/tmp/ABP-777.mp4";
    const secondPath = "/tmp/ABP-888.mp4";
    const firstStarted = deferred<void>();
    const scrapeFileSpy = vi
      .spyOn(FileScraper.prototype, "scrapeFile")
      .mockImplementation(async (filePath, _progress, signal) => {
        if (filePath !== firstPath) throw new Error(`Unexpected scrape start for ${filePath}`);
        firstStarted.resolve();
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(createAbortError()), { once: true });
        });
        throw new Error("unreachable");
      });

    await service.retryFiles([firstPath, secondPath]);
    await firstStarted.promise;
    await service.stop();

    expect(scrapeFileSpy).toHaveBeenCalledTimes(1);
    expect(scrapeFileSpy).toHaveBeenCalledWith(firstPath, { fileIndex: 1, totalFiles: 2 }, expect.any(AbortSignal));
    expect(service.getStatus().running).toBe(false);
  });

  it("shutdown aborts without committing outcomes or a summary", async () => {
    const { executionStore, signalService, service } = createService();
    mockConfig();
    const mediaFilePath = await createTempMediaFile("ABP-999.mp4");
    vi.spyOn(FileScraper.prototype, "scrapeFile").mockImplementation(abortableScrape);

    await service.startSingle([mediaFilePath]);
    await service.shutdown({ timeoutMs: 500 });

    expect(service.getStatus().running).toBe(false);
    expect(executionStore.committed).toEqual([]);
    expect(executionStore.finalized).toEqual([]);
    expect(signalService.buttonStatusEvents.at(-1)).toEqual({ startEnabled: false, stopEnabled: true });
  });
});
