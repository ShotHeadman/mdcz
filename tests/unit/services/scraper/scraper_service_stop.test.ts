import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configManager, configurationSchema, defaultConfiguration } from "@main/services/config";
import { CrawlerProvider, FetchGateway } from "@main/services/crawler";
import { NetworkClient } from "@main/services/network";
import { SignalService } from "@main/services/SignalService";
import { createAbortError } from "@main/services/scraper/abort";
import { FileScraper } from "@main/services/scraper/FileScraper";
import { ScraperService } from "@main/services/scraper/ScraperService";
import type { ScrapeResult } from "@shared/types";
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

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const waitForIdle = async (service: ScraperService, signalService?: CaptureSignalService): Promise<void> => {
  for (let i = 0; i < 60; i += 1) {
    const idle = !service.getStatus().running;
    const buttonsReset =
      !signalService ||
      (signalService.buttonStatusEvents.at(-1)?.startEnabled === true &&
        signalService.buttonStatusEvents.at(-1)?.stopEnabled === false);
    if (idle && buttonsReset) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }
  throw new Error("Scraper did not become idle in time");
};

describe("ScraperService stop flow", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map((dirPath) => rm(dirPath, { recursive: true, force: true })),
    );
    vi.restoreAllMocks();
  });

  it("emits immediate stopping button status and finishes cleanly", async () => {
    const signalService = new CaptureSignalService(null);
    const networkClient = new NetworkClient();
    const crawlerProvider = new CrawlerProvider({
      fetchGateway: new FetchGateway(networkClient),
    });
    const service = new ScraperService(signalService, networkClient, crawlerProvider);
    const config = configurationSchema.parse(defaultConfiguration);
    const runningTask = deferred<ScrapeResult>();
    const mediaFilePath = await createTempMediaFile("ABP-123.mp4");

    vi.spyOn(configManager, "ensureLoaded").mockResolvedValue(undefined);
    vi.spyOn(configManager, "get").mockResolvedValue(config);
    vi.spyOn(FileScraper.prototype, "scrapeFile").mockImplementation(() => runningTask.promise);

    await service.start("single", [mediaFilePath]);
    const stopResult = service.stop();

    expect(stopResult.pendingCount).toBe(0);
    expect(service.getStatus().running).toBe(true);
    expect(signalService.buttonStatusEvents).toEqual([
      { startEnabled: false, stopEnabled: true },
      { startEnabled: false, stopEnabled: false },
    ]);

    runningTask.resolve({
      status: "success",
      fileId: "abp-123",
      fileInfo: {
        filePath: mediaFilePath,
        fileName: "ABP-123.mp4",
        extension: ".mp4",
        number: "ABP-123",
        isSubtitled: false,
      },
      crawlerData: {
        title: "ABP-123",
        number: "ABP-123",
        actors: [],
        genres: [],
        scene_images: [],
        website: config.scrape.sites[0],
      },
    });

    await waitForIdle(service, signalService);

    expect(service.getStatus().running).toBe(false);
    expect(signalService.buttonStatusEvents.at(-1)).toEqual({ startEnabled: true, stopEnabled: false });
  });

  it("updates status state when pausing and resuming", async () => {
    const signalService = new CaptureSignalService(null);
    const networkClient = new NetworkClient();
    const crawlerProvider = new CrawlerProvider({
      fetchGateway: new FetchGateway(networkClient),
    });
    const service = new ScraperService(signalService, networkClient, crawlerProvider);
    const config = configurationSchema.parse(defaultConfiguration);
    const runningTask = deferred<ScrapeResult>();
    const mediaFilePath = await createTempMediaFile("ABP-456.mp4");

    vi.spyOn(configManager, "ensureLoaded").mockResolvedValue(undefined);
    vi.spyOn(configManager, "get").mockResolvedValue(config);
    vi.spyOn(FileScraper.prototype, "scrapeFile").mockImplementation(() => runningTask.promise);

    await service.start("single", [mediaFilePath]);
    expect(service.getStatus().state).toBe("running");

    service.pause();
    expect(service.getStatus().state).toBe("paused");

    service.resume();
    expect(service.getStatus().state).toBe("running");

    runningTask.resolve({
      status: "success",
      fileId: "abp-456",
      fileInfo: {
        filePath: mediaFilePath,
        fileName: "ABP-456.mp4",
        extension: ".mp4",
        number: "ABP-456",
        isSubtitled: false,
      },
      crawlerData: {
        title: "ABP-456",
        number: "ABP-456",
        actors: [],
        genres: [],
        scene_images: [],
        website: config.scrape.sites[0],
      },
    });

    await waitForIdle(service, signalService);
    expect(service.getStatus().state).toBe("idle");
  });

  it("finishes cleanly when stop aborts a task waiting in the rest gate", async () => {
    const signalService = new CaptureSignalService(null);
    const networkClient = new NetworkClient();
    const crawlerProvider = new CrawlerProvider({
      fetchGateway: new FetchGateway(networkClient),
    });
    const service = new ScraperService(signalService, networkClient, crawlerProvider);
    const config = configurationSchema.parse({
      ...defaultConfiguration,
      scrape: {
        ...defaultConfiguration.scrape,
        threadNumber: 2,
        restAfterCount: 1,
        restDuration: 60,
      },
    });
    const firstTask = deferred<ScrapeResult>();
    const filePaths = ["/tmp/ABP-777.mp4", "/tmp/ABP-888.mp4"];

    vi.spyOn(configManager, "ensureLoaded").mockResolvedValue(undefined);
    vi.spyOn(configManager, "get").mockResolvedValue(config);
    const scrapeFileSpy = vi.spyOn(FileScraper.prototype, "scrapeFile").mockImplementation((filePath) => {
      if (filePath === filePaths[0]) {
        return firstTask.promise;
      }

      throw new Error(`Unexpected scrape start for ${filePath}`);
    });

    await service.retryFiles(filePaths);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    service.stop();

    firstTask.resolve({
      status: "success",
      fileId: "abp-777",
      fileInfo: {
        filePath: filePaths[0],
        fileName: "ABP-777.mp4",
        extension: ".mp4",
        number: "ABP-777",
        isSubtitled: false,
      },
      crawlerData: {
        title: "ABP-777",
        number: "ABP-777",
        actors: [],
        genres: [],
        scene_images: [],
        website: config.scrape.sites[0],
      },
    });

    await waitForIdle(service, signalService);

    expect(scrapeFileSpy).toHaveBeenCalledTimes(1);
    expect(scrapeFileSpy).toHaveBeenCalledWith(
      filePaths[0],
      { fileIndex: 1, totalFiles: filePaths.length },
      expect.any(AbortSignal),
    );
    expect(service.getStatus().running).toBe(false);
  });

  it("shutdown aborts the active scrape and waits until the session is idle", async () => {
    const signalService = new CaptureSignalService(null);
    const networkClient = new NetworkClient();
    const crawlerProvider = new CrawlerProvider({
      fetchGateway: new FetchGateway(networkClient),
    });
    const service = new ScraperService(signalService, networkClient, crawlerProvider);
    const config = configurationSchema.parse(defaultConfiguration);
    const mediaFilePath = await createTempMediaFile("ABP-999.mp4");

    vi.spyOn(configManager, "ensureLoaded").mockResolvedValue(undefined);
    vi.spyOn(configManager, "get").mockResolvedValue(config);
    vi.spyOn(FileScraper.prototype, "scrapeFile").mockImplementation(
      (_filePath, _progress, signal) =>
        new Promise((_resolve, reject) => {
          if (signal?.aborted) {
            reject(createAbortError());
            return;
          }

          signal?.addEventListener(
            "abort",
            () => {
              reject(createAbortError());
            },
            { once: true },
          );
        }),
    );

    await service.start("single", [mediaFilePath]);
    await service.shutdown({ timeoutMs: 500 });

    expect(service.getStatus().running).toBe(false);
    expect(signalService.buttonStatusEvents.at(-1)).toEqual({ startEnabled: true, stopEnabled: false });
  });
});
