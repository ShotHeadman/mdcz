import { configManager, configurationSchema, defaultConfiguration } from "@main/services/config";
import { CrawlerProvider, FetchGateway } from "@main/services/crawler";
import { NetworkClient } from "@main/services/network";
import { SignalService } from "@main/services/SignalService";
import { FileScraper } from "@main/services/scraper/FileScraper";
import { ScraperService } from "@main/services/scraper/ScraperService";
import type { ScrapeResult } from "@shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  afterEach(() => {
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

    vi.spyOn(configManager, "ensureLoaded").mockResolvedValue(undefined);
    vi.spyOn(configManager, "get").mockResolvedValue(config);
    vi.spyOn(FileScraper.prototype, "scrapeFile").mockImplementation(() => runningTask.promise);

    await service.start("single", ["/tmp/ABP-123.mp4"]);
    const stopResult = service.stop();

    expect(stopResult.pendingCount).toBe(0);
    expect(service.getStatus().running).toBe(true);
    expect(signalService.buttonStatusEvents).toEqual([
      { startEnabled: false, stopEnabled: true },
      { startEnabled: false, stopEnabled: false },
    ]);

    runningTask.resolve({
      status: "success",
      fileInfo: {
        filePath: "/tmp/ABP-123.mp4",
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
        sample_images: [],
        website: config.scrape.enabledSites[0],
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

    vi.spyOn(configManager, "ensureLoaded").mockResolvedValue(undefined);
    vi.spyOn(configManager, "get").mockResolvedValue(config);
    vi.spyOn(FileScraper.prototype, "scrapeFile").mockImplementation(() => runningTask.promise);

    await service.start("single", ["/tmp/ABP-456.mp4"]);
    expect(service.getStatus().state).toBe("running");

    service.pause();
    expect(service.getStatus().state).toBe("paused");

    service.resume();
    expect(service.getStatus().state).toBe("running");

    runningTask.resolve({
      status: "success",
      fileInfo: {
        filePath: "/tmp/ABP-456.mp4",
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
        sample_images: [],
        website: config.scrape.enabledSites[0],
      },
    });

    await waitForIdle(service, signalService);
    expect(service.getStatus().state).toBe("idle");
  });
});
