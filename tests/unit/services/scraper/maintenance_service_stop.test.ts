import { configManager, configurationSchema, defaultConfiguration } from "@main/services/config";
import { CrawlerProvider, FetchGateway } from "@main/services/crawler";
import { NetworkClient } from "@main/services/network";
import { SignalService } from "@main/services/SignalService";
import { MaintenanceFileScraper } from "@main/services/scraper/maintenance/MaintenanceFileScraper";
import { MaintenanceService } from "@main/services/scraper/maintenance/MaintenanceService";
import { Website } from "@shared/enums";
import type { MaintenanceCommitItem, MaintenanceItemResult, ScrapeResult } from "@shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

class CaptureSignalService extends SignalService {
  readonly itemResults: MaintenanceItemResult[] = [];

  override showMaintenanceItemResult(payload: MaintenanceItemResult): void {
    this.itemResults.push(payload);
    super.showMaintenanceItemResult(payload);
  }
}

type MaintenanceProcessLikeResult = {
  scrapeResult: ScrapeResult;
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const waitForIdle = async (service: MaintenanceService): Promise<void> => {
  for (let i = 0; i < 60; i += 1) {
    if (service.getStatus().state === "idle") {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }
  throw new Error("Maintenance service did not become idle in time");
};

const createCommitItem = (id: string): MaintenanceCommitItem => ({
  entry: {
    id,
    videoPath: `/tmp/${id}.mp4`,
    fileInfo: {
      filePath: `/tmp/${id}.mp4`,
      fileName: `${id}.mp4`,
      extension: ".mp4",
      number: id.toUpperCase(),
      isSubtitled: false,
    },
    crawlerData: {
      title: id,
      number: id.toUpperCase(),
      actors: [],
      genres: [],
      sample_images: [],
      website: Website.DMM,
    },
    assets: {
      sceneImages: [],
      actorPhotos: [],
    },
    currentDir: "/tmp",
  },
});

describe("MaintenanceService stop flow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks cleared maintenance items with a terminal result after stopping", async () => {
    const signalService = new CaptureSignalService(null);
    const networkClient = new NetworkClient();
    const crawlerProvider = new CrawlerProvider({
      fetchGateway: new FetchGateway(networkClient),
    });
    const service = new MaintenanceService(signalService, networkClient, crawlerProvider);
    const config = configurationSchema.parse({
      ...defaultConfiguration,
      scrape: {
        ...defaultConfiguration.scrape,
        threadNumber: 1,
      },
    });
    const runningTask = deferred<MaintenanceProcessLikeResult>();

    vi.spyOn(configManager, "ensureLoaded").mockResolvedValue(undefined);
    vi.spyOn(configManager, "get").mockResolvedValue(config);
    vi.spyOn(MaintenanceFileScraper.prototype, "processFile").mockImplementationOnce(
      () => runningTask.promise as never,
    );

    await service.execute([createCommitItem("abp-123"), createCommitItem("abp-456")], "organize_files");
    service.stop();

    runningTask.resolve({
      scrapeResult: {
        status: "success",
        fileInfo: {
          filePath: "/tmp/abp-123.mp4",
          fileName: "abp-123.mp4",
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
          website: Website.DMM,
        },
      } satisfies ScrapeResult,
    });

    await waitForIdle(service);

    expect(service.getStatus()).toMatchObject({
      state: "idle",
      totalEntries: 0,
      completedEntries: 0,
      successCount: 0,
      failedCount: 0,
    });
    expect(signalService.itemResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entryId: "abp-123",
          status: "processing",
        }),
        expect.objectContaining({
          entryId: "abp-123",
          status: "success",
        }),
        expect.objectContaining({
          entryId: "abp-456",
          status: "failed",
          error: "维护已停止，项目未执行",
        }),
      ]),
    );
  });

  it("rejects executing the scan-only local-read preset", async () => {
    const signalService = new CaptureSignalService(null);
    const networkClient = new NetworkClient();
    const crawlerProvider = new CrawlerProvider({
      fetchGateway: new FetchGateway(networkClient),
    });
    const service = new MaintenanceService(signalService, networkClient, crawlerProvider);
    const config = configurationSchema.parse(defaultConfiguration);

    vi.spyOn(configManager, "ensureLoaded").mockResolvedValue(undefined);
    vi.spyOn(configManager, "get").mockResolvedValue(config);

    await expect(service.execute([createCommitItem("abp-123")], "read_local")).rejects.toThrow(
      "当前预设仅用于扫描本地数据，无需执行",
    );
    expect(service.getStatus()).toMatchObject({
      state: "idle",
      totalEntries: 0,
      completedEntries: 0,
      successCount: 0,
      failedCount: 0,
    });
  });
});
