import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configManager, configurationSchema, defaultConfiguration } from "@main/services/config";
import type { OutputLibraryScanner } from "@main/services/library";
import type { DesktopPersistenceService } from "@main/services/persistence";
import { SignalService } from "@main/services/SignalService";
import { FileScraper } from "@main/services/scraper/FileScraper";
import { ScraperService } from "@main/services/scraper/ScraperService";
import { createAbortError } from "@main/utils/abort";
import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import { NetworkClient } from "@mdcz/runtime/network";
import { AggregationService } from "@mdcz/runtime/scrape";
import type { ScrapeResult } from "@mdcz/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

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

const createService = (signalService = new CaptureSignalService(null)) => {
  const networkClient = new NetworkClient();
  const crawlerProvider = new CrawlerProvider({ fetchGateway: new FetchGateway(networkClient) });
  return {
    signalService,
    service: new ScraperService(signalService, networkClient, crawlerProvider),
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

  it("emits immediate stopping button status and finishes cleanly", async () => {
    const { signalService, service } = createService();
    const config = mockConfig();
    const runningTask = deferred<ScrapeResult>();
    const mediaFilePath = await createTempMediaFile("ABP-123.mp4");
    vi.spyOn(FileScraper.prototype, "scrapeFile").mockImplementation(() => runningTask.promise);

    await service.startSingle([mediaFilePath]);
    const stopResult = service.stop();

    expect(stopResult.pendingCount).toBe(0);
    expect(service.getStatus().running).toBe(true);
    expect(signalService.buttonStatusEvents).toEqual([
      { startEnabled: false, stopEnabled: true },
      { startEnabled: false, stopEnabled: false },
    ]);

    runningTask.resolve(successResult(mediaFilePath, "ABP-123", config.scrape.sites[0]));
    await service.waitForIdle();

    expect(service.getStatus().running).toBe(false);
    expect(signalService.buttonStatusEvents.at(-1)).toEqual({ startEnabled: true, stopEnabled: false });
  });

  it("persists successful acquisitions to the library and invalidates output summary before clearing aggregation cache", async () => {
    const events: string[] = [];
    const signalService = new CaptureSignalService(null);
    const upsertRoot = vi.fn(async (input) => input);
    const upsertScrapeOutput = vi.fn(async (input: { fileCount: number }) => {
      events.push(`persist-output:${input.fileCount}`);
      return { id: "output-1" };
    });
    const upsertEntry = vi.fn(async (input: { number?: string | null; lastKnownPath?: string | null }) => {
      events.push(`persist-entry:${input.number}:${input.lastKnownPath}`);
      return { id: "entry-1" };
    });
    const persistenceService = {
      getState: vi.fn(async () => ({
        repositories: {
          library: { upsertScrapeOutput, upsertEntry },
          mediaRoots: { upsert: upsertRoot },
        },
      })),
    } as unknown as DesktopPersistenceService;
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
      persistenceService,
    );
    const outputRoot = join(tmpdir(), "mdcz-output");
    const config = mockConfig(
      configurationSchema.parse({
        ...defaultConfiguration,
        paths: { ...defaultConfiguration.paths, outputSummaryPath: outputRoot },
      }),
    );
    const mediaFilePath = await createTempMediaFile("ABP-789.mp4");
    const outputVideoPath = join(outputRoot, "ABP-789.mp4");
    const outputFolderPath = join(outputRoot, "ABP-789");
    const posterPath = join(outputFolderPath, "poster.jpg");

    vi.spyOn(AggregationService.prototype, "clearCache").mockImplementation(() => {
      events.push("clear-cache");
    });
    vi.spyOn(FileScraper.prototype, "scrapeFile").mockResolvedValue({
      status: "success",
      fileId: "abp-789",
      fileInfo: {
        filePath: outputVideoPath,
        fileName: "ABP-789.mp4",
        extension: ".mp4",
        number: "ABP-789",
        isSubtitled: false,
      },
      crawlerData: {
        title: "ABP-789 title",
        number: "ABP-789",
        actors: ["Actor A"],
        genres: [],
        scene_images: [],
        website: config.scrape.sites[0],
      },
      assets: { poster: posterPath, sceneImages: [], downloaded: [posterPath] },
      outputPath: outputFolderPath,
    });

    await service.startSingle([mediaFilePath]);
    await service.waitForIdle();

    expect(upsertScrapeOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: expect.any(String),
        rootId: "desktop-output",
        outputDirectory: outputRoot,
        fileCount: 1,
        totalBytes: 0,
        completedAt: expect.any(Date),
      }),
    );
    expect(upsertEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaIdentity: "ABP-789",
        rootId: "desktop-output",
        rootRelativePath: "ABP-789.mp4",
        sourceTaskId: expect.any(String),
        scrapeOutputId: "output-1",
        title: "ABP-789 title",
        number: "ABP-789",
        actors: ["Actor A"],
        thumbnailPath: "ABP-789/poster.jpg",
        lastKnownPath: "ABP-789.mp4",
        createdAt: expect.any(Date),
      }),
    );
    expect(upsertRoot).toHaveBeenCalledWith(expect.objectContaining({ id: "desktop-output", hostPath: outputRoot }));
    expect(outputLibraryScanner.invalidate).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["persist-output:1", "persist-entry:ABP-789:ABP-789.mp4", "invalidate", "clear-cache"]);
  });

  it("projects pause and resume onto scraper status without shared FSM retesting", async () => {
    const { signalService, service } = createService();
    const config = mockConfig();
    const runningTask = deferred<ScrapeResult>();
    const mediaFilePath = await createTempMediaFile("ABP-456.mp4");
    vi.spyOn(FileScraper.prototype, "scrapeFile").mockImplementation(() => runningTask.promise);

    await service.startSingle([mediaFilePath]);
    expect(service.getStatus().state).toBe("running");
    service.pause();
    expect(service.getStatus().state).toBe("paused");
    service.resume();
    expect(service.getStatus().state).toBe("running");

    runningTask.resolve(successResult(mediaFilePath, "ABP-456", config.scrape.sites[0]));
    await service.waitForIdle();
    expect(service.getStatus().state).toBe("idle");
    expect(signalService.buttonStatusEvents.at(-1)).toEqual({ startEnabled: true, stopEnabled: false });
  });

  it("finishes cleanly when stop aborts a task waiting in the rest gate", async () => {
    const { service } = createService();
    const config = mockConfig(
      configurationSchema.parse({
        ...defaultConfiguration,
        scrape: { ...defaultConfiguration.scrape, threadNumber: 2, restAfterCount: 1, restDuration: 60 },
      }),
    );
    const firstTask = deferred<ScrapeResult>();
    const firstPath = "/tmp/ABP-777.mp4";
    const secondPath = "/tmp/ABP-888.mp4";
    const filePaths = [firstPath, secondPath];
    const firstStarted = deferred<void>();
    const scrapeFileSpy = vi.spyOn(FileScraper.prototype, "scrapeFile").mockImplementation((filePath) => {
      if (filePath === firstPath) {
        firstStarted.resolve();
        return firstTask.promise;
      }
      throw new Error(`Unexpected scrape start for ${filePath}`);
    });

    const retryPromise = service.retryFiles(filePaths);
    await firstStarted.promise;
    service.stop();
    firstTask.resolve(successResult(firstPath, "ABP-777", config.scrape.sites[0]));
    await retryPromise;
    await service.waitForIdle();

    expect(scrapeFileSpy).toHaveBeenCalledTimes(1);
    expect(scrapeFileSpy).toHaveBeenCalledWith(
      firstPath,
      { fileIndex: 1, totalFiles: filePaths.length },
      expect.any(AbortSignal),
    );
    expect(service.getStatus().running).toBe(false);
  });

  it("shutdown aborts the active scrape and waits until the session is idle", async () => {
    const { signalService, service } = createService();
    mockConfig();
    const mediaFilePath = await createTempMediaFile("ABP-999.mp4");
    vi.spyOn(FileScraper.prototype, "scrapeFile").mockImplementation(abortableScrape);

    await service.startSingle([mediaFilePath]);
    await service.shutdown({ timeoutMs: 500 });

    expect(service.getStatus().running).toBe(false);
    expect(signalService.buttonStatusEvents.at(-1)).toEqual({ startEnabled: true, stopEnabled: false });
  });
});
