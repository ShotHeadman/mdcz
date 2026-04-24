import { configManager, configurationSchema, defaultConfiguration } from "@main/services/config";
import { CrawlerProvider, FetchGateway } from "@main/services/crawler";
import { NetworkClient } from "@main/services/network";
import { SignalService } from "@main/services/SignalService";
import { createAbortError } from "@main/services/scraper/abort";
import { LocalScanService } from "@main/services/scraper/maintenance/LocalScanService";
import { MaintenanceFileScraper } from "@main/services/scraper/maintenance/MaintenanceFileScraper";
import { MaintenanceService } from "@main/services/scraper/maintenance/MaintenanceService";
import { Website } from "@shared/enums";
import type { MaintenanceCommitItem, MaintenanceItemResult, MaintenancePreviewItem } from "@shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

class CaptureSignalService extends SignalService {
  readonly itemResults: MaintenanceItemResult[] = [];

  override showMaintenanceItemResult(payload: MaintenanceItemResult): void {
    this.itemResults.push(payload);
    super.showMaintenanceItemResult(payload);
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
    fileId: id,
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
      scene_images: [],
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
    const runningTask = deferred<MaintenanceItemResult>();

    vi.spyOn(configManager, "ensureLoaded").mockResolvedValue(undefined);
    vi.spyOn(configManager, "get").mockResolvedValue(config);
    vi.spyOn(MaintenanceFileScraper.prototype, "processFile").mockImplementationOnce(
      () => runningTask.promise as never,
    );

    await service.execute([createCommitItem("abp-123"), createCommitItem("abp-456")], "organize_files");
    service.stop();

    runningTask.resolve({
      status: "success",
      fileId: "abp-123",
      crawlerData: {
        title: "ABP-123",
        number: "ABP-123",
        actors: [],
        genres: [],
        scene_images: [],
        website: Website.DMM,
      },
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
          fileId: "abp-123",
          status: "processing",
        }),
        expect.objectContaining({
          fileId: "abp-123",
          status: "success",
        }),
        expect.objectContaining({
          fileId: "abp-456",
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

  it("pauses queued maintenance work and resumes it later", async () => {
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
    const firstTask = deferred<MaintenanceItemResult>();

    vi.spyOn(configManager, "ensureLoaded").mockResolvedValue(undefined);
    vi.spyOn(configManager, "get").mockResolvedValue(config);
    vi.spyOn(MaintenanceFileScraper.prototype, "processFile")
      .mockImplementationOnce(() => firstTask.promise as never)
      .mockImplementationOnce(
        async (_entry) =>
          ({
            status: "success",
            fileId: "abp-457",
            crawlerData: {
              title: "ABP-457",
              number: "ABP-457",
              actors: [],
              genres: [],
              scene_images: [],
              website: Website.DMM,
            },
          }) as MaintenanceItemResult,
      );

    await service.execute([createCommitItem("abp-456"), createCommitItem("abp-457")], "organize_files");
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    service.pause();
    expect(service.getStatus().state).toBe("paused");

    firstTask.resolve({
      status: "success",
      fileId: "abp-456",
      crawlerData: {
        title: "ABP-456",
        number: "ABP-456",
        actors: [],
        genres: [],
        scene_images: [],
        website: Website.DMM,
      },
    });

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(signalService.itemResults).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fileId: "abp-457",
          status: "processing",
        }),
      ]),
    );

    service.resume();
    expect(service.getStatus().state).toBe("executing");

    await waitForIdle(service);

    expect(signalService.itemResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fileId: "abp-456",
          status: "success",
        }),
        expect.objectContaining({
          fileId: "abp-457",
          status: "success",
        }),
      ]),
    );
  });

  it("shutdown aborts the active maintenance run and waits until it becomes idle", async () => {
    const signalService = new CaptureSignalService(null);
    const networkClient = new NetworkClient();
    const crawlerProvider = new CrawlerProvider({
      fetchGateway: new FetchGateway(networkClient),
    });
    const service = new MaintenanceService(signalService, networkClient, crawlerProvider);
    const config = configurationSchema.parse(defaultConfiguration);

    vi.spyOn(configManager, "ensureLoaded").mockResolvedValue(undefined);
    vi.spyOn(configManager, "get").mockResolvedValue(config);
    vi.spyOn(MaintenanceFileScraper.prototype, "processFile").mockImplementation(
      (_entry, _config, _progress, signal) =>
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
        }) as never,
    );

    await service.execute([createCommitItem("abp-789")], "organize_files");
    await service.shutdown({ timeoutMs: 500 });

    expect(service.getStatus().state).toBe("idle");
  });

  it("shutdown aborts an active maintenance preview and waits until it becomes idle", async () => {
    const signalService = new CaptureSignalService(null);
    const networkClient = new NetworkClient();
    const crawlerProvider = new CrawlerProvider({
      fetchGateway: new FetchGateway(networkClient),
    });
    const service = new MaintenanceService(signalService, networkClient, crawlerProvider);
    const config = configurationSchema.parse(defaultConfiguration);

    vi.spyOn(configManager, "ensureLoaded").mockResolvedValue(undefined);
    vi.spyOn(configManager, "get").mockResolvedValue(config);
    vi.spyOn(MaintenanceFileScraper.prototype, "previewFile").mockImplementation(
      (_entry, _config, signal) =>
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

    const previewPromise = service.preview([createCommitItem("abp-900").entry], "organize_files");
    await service.shutdown({ timeoutMs: 500 });

    await expect(previewPromise).rejects.toThrow("Operation aborted");
    expect(service.getStatus().state).toBe("idle");
  });

  it("stop aborts an active maintenance preview and waits until it becomes idle", async () => {
    const signalService = new CaptureSignalService(null);
    const networkClient = new NetworkClient();
    const crawlerProvider = new CrawlerProvider({
      fetchGateway: new FetchGateway(networkClient),
    });
    const service = new MaintenanceService(signalService, networkClient, crawlerProvider);
    const config = configurationSchema.parse(defaultConfiguration);

    vi.spyOn(configManager, "ensureLoaded").mockResolvedValue(undefined);
    vi.spyOn(configManager, "get").mockResolvedValue(config);
    vi.spyOn(MaintenanceFileScraper.prototype, "previewFile").mockImplementation(
      (_entry, _config, signal) =>
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

    const previewPromise = service.preview([createCommitItem("abp-901").entry], "organize_files");
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(service.getStatus().state).toBe("previewing");
    service.stop();

    await expect(previewPromise).rejects.toThrow("Operation aborted");
    expect(service.getStatus().state).toBe("idle");
  });

  it("pauses queued maintenance preview work and resumes it later", async () => {
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
    const firstPreview = deferred<MaintenancePreviewItem>();
    const previewSpy = vi
      .spyOn(MaintenanceFileScraper.prototype, "previewFile")
      .mockImplementationOnce(() => firstPreview.promise)
      .mockImplementationOnce(async (entry) => ({
        fileId: entry.fileId,
        status: "ready",
      }));

    vi.spyOn(configManager, "ensureLoaded").mockResolvedValue(undefined);
    vi.spyOn(configManager, "get").mockResolvedValue(config);

    const previewPromise = service.preview(
      [createCommitItem("abp-902").entry, createCommitItem("abp-903").entry],
      "organize_files",
    );
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(previewSpy).toHaveBeenCalledTimes(1);
    service.pause();
    expect(service.getStatus().state).toBe("paused");

    firstPreview.resolve({
      fileId: "abp-902",
      status: "ready",
    });

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(previewSpy).toHaveBeenCalledTimes(1);

    service.resume();
    expect(service.getStatus().state).toBe("previewing");

    await expect(previewPromise).resolves.toEqual({
      items: [
        {
          fileId: "abp-902",
          status: "ready",
        },
        {
          fileId: "abp-903",
          status: "ready",
        },
      ],
    });
    expect(service.getStatus().state).toBe("idle");
  });

  it("shutdown aborts an active maintenance scan and waits until it becomes idle", async () => {
    const signalService = new CaptureSignalService(null);
    const networkClient = new NetworkClient();
    const crawlerProvider = new CrawlerProvider({
      fetchGateway: new FetchGateway(networkClient),
    });
    const service = new MaintenanceService(signalService, networkClient, crawlerProvider);
    const config = configurationSchema.parse(defaultConfiguration);

    vi.spyOn(configManager, "ensureLoaded").mockResolvedValue(undefined);
    vi.spyOn(configManager, "get").mockResolvedValue(config);
    vi.spyOn(LocalScanService.prototype, "scan").mockImplementation(
      async (_dirPath, _sceneImagesFolder, signal) =>
        await new Promise((_resolve, reject) => {
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

    const scanPromise = service.scan("/tmp");
    await service.shutdown({ timeoutMs: 500 });

    await expect(scanPromise).rejects.toThrow("Operation aborted");
    expect(service.getStatus().state).toBe("idle");
  });
});
