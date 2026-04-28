import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { SignalService } from "@main/services/SignalService";
import type { AggregationService } from "@main/services/scraper/aggregation";
import type { DownloadManager } from "@main/services/scraper/DownloadManager";
import type { FileOrganizer, OrganizePlan } from "@main/services/scraper/FileOrganizer";
import { createFileScraper } from "@main/services/scraper/FileScraper";
import type { NfoGenerator } from "@main/services/scraper/NfoGenerator";
import type { TranslateService } from "@main/services/scraper/TranslateService";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData, FileInfo } from "@mdcz/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockConfigManager } from "./helpers";

const config = configurationSchema.parse({
  ...defaultConfiguration,
  download: {
    ...defaultConfiguration.download,
    generateNfo: false,
  },
});

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Sample Title",
  number: "ABC-123",
  actors: [],
  genres: [],
  scene_images: [],
  website: Website.DMM,
  ...overrides,
});

const createAggregationResult = (data: CrawlerData) => ({
  data,
  sources: {},
  imageAlternatives: {
    thumb_url: [],
    poster_url: [],
    fanart_url: [],
    scene_images: [],
  },
  stats: {
    totalSites: 1,
    successCount: 1,
    failedCount: 0,
    skippedCount: 0,
    siteResults: [],
    totalElapsedMs: 1,
  },
});

const createPlan = (fileInfo: FileInfo): OrganizePlan => ({
  outputDir: `/output/${fileInfo.number}`,
  targetVideoPath: `/output/${fileInfo.number}/${fileInfo.fileName}${fileInfo.extension}`,
  nfoPath: `/output/${fileInfo.number}/${fileInfo.number}.nfo`,
});

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-file-scraper-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const createScraper = (
  aggregate: ReturnType<typeof vi.fn>,
  overrides: {
    downloadAll?: ReturnType<typeof vi.fn>;
    ensureOutputReady?: ReturnType<typeof vi.fn>;
    organizeVideo?: ReturnType<typeof vi.fn>;
    moveToFailedFolder?: ReturnType<typeof vi.fn>;
  } = {},
) => {
  mockConfigManager(config);
  const downloadAll =
    overrides.downloadAll ??
    vi.fn().mockResolvedValue({
      downloaded: [],
      sceneImages: [],
    });
  const ensureOutputReady = overrides.ensureOutputReady ?? vi.fn(async (plan: OrganizePlan) => plan);
  const organizeVideo =
    overrides.organizeVideo ?? vi.fn(async (_fileInfo: FileInfo, plan: OrganizePlan) => plan.targetVideoPath);
  const moveToFailedFolder = overrides.moveToFailedFolder ?? vi.fn(async (fileInfo: FileInfo) => fileInfo.filePath);

  const scraper = createFileScraper({
    aggregationService: {
      aggregate,
    } as unknown as AggregationService,
    translateService: {
      translateCrawlerData: vi.fn(async (data: CrawlerData) => data),
    } as unknown as TranslateService,
    nfoGenerator: {
      writeNfo: vi.fn(),
    } as unknown as NfoGenerator,
    downloadManager: {
      downloadAll,
    } as unknown as DownloadManager,
    fileOrganizer: {
      plan: vi.fn((fileInfo: FileInfo) => createPlan(fileInfo)),
      ensureOutputReady,
      organizeVideo,
      moveToFailedFolder,
    } as unknown as FileOrganizer,
    signalService: new SignalService(null),
  });

  return {
    scraper,
    mocks: {
      downloadAll,
      ensureOutputReady,
      organizeVideo,
      moveToFailedFolder,
    },
  };
};

describe("FileScraper multipart aggregation cache", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map((dirPath) => rm(dirPath, { recursive: true, force: true })),
    );
  });

  it("reuses one aggregation request for same-number multipart files", async () => {
    const aggregate = vi.fn().mockResolvedValue(createAggregationResult(createCrawlerData({ number: "FC2-123456" })));
    const { scraper } = createScraper(aggregate);

    const [part1, part2] = await Promise.all([
      scraper.scrapeFile("/tmp/FC2-123456-1.mp4", { fileIndex: 1, totalFiles: 2 }),
      scraper.scrapeFile("/tmp/FC2-123456-2.mp4", { fileIndex: 2, totalFiles: 2 }),
    ]);

    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(part1.status).toBe("success");
    expect(part2.status).toBe("success");
    expect(part1.fileInfo.part?.number).toBe(1);
    expect(part2.fileInfo.part?.number).toBe(2);
    expect(part1.fileInfo.filePath).toContain("FC2-123456-1");
    expect(part2.fileInfo.filePath).toContain("FC2-123456-2");
  });

  it("reuses one aggregation request for alphabetic multipart files", async () => {
    const aggregate = vi.fn().mockResolvedValue(createAggregationResult(createCrawlerData({ number: "IDBD-905" })));
    const { scraper } = createScraper(aggregate);

    const [partA, partH] = await Promise.all([
      scraper.scrapeFile("/tmp/IDBD-905-A.mp4", { fileIndex: 1, totalFiles: 2 }),
      scraper.scrapeFile("/tmp/IDBD-905-H.mp4", { fileIndex: 2, totalFiles: 2 }),
    ]);

    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(partA.status).toBe("success");
    expect(partH.status).toBe("success");
    expect(partA.fileInfo.part?.number).toBe(1);
    expect(partH.fileInfo.part?.number).toBe(8);
    expect(partA.fileInfo.filePath).toContain("IDBD-905-A");
    expect(partH.fileInfo.filePath).toContain("IDBD-905-H");
  });

  it("keeps aggregation requests separate for different numbers", async () => {
    const aggregate = vi
      .fn()
      .mockResolvedValueOnce(createAggregationResult(createCrawlerData({ number: "ABC-123" })))
      .mockResolvedValueOnce(createAggregationResult(createCrawlerData({ number: "XYZ-999" })));
    const { scraper } = createScraper(aggregate);

    const [first, second] = await Promise.all([
      scraper.scrapeFile("/tmp/ABC-123-1.mp4", { fileIndex: 1, totalFiles: 2 }),
      scraper.scrapeFile("/tmp/XYZ-999-1.mp4", { fileIndex: 2, totalFiles: 2 }),
    ]);

    expect(aggregate).toHaveBeenCalledTimes(2);
    expect(first.status).toBe("success");
    expect(second.status).toBe("success");
  });

  it("propagates shared aggregation failures to each multipart result", async () => {
    const aggregate = vi.fn().mockRejectedValue(new Error("aggregate failed"));
    const { scraper } = createScraper(aggregate);

    const [part1, part2] = await Promise.all([
      scraper.scrapeFile("/tmp/FC2-123456-1.mp4", { fileIndex: 1, totalFiles: 2 }),
      scraper.scrapeFile("/tmp/FC2-123456-2.mp4", { fileIndex: 2, totalFiles: 2 }),
    ]);

    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(part1).toMatchObject({
      status: "failed",
      error: "aggregate failed",
    });
    expect(part2).toMatchObject({
      status: "failed",
      error: "aggregate failed",
    });
  });

  it("serializes same-number multipart files before output planning", async () => {
    const aggregate = vi.fn().mockResolvedValue(createAggregationResult(createCrawlerData({ number: "FC2-123456" })));
    let markFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    let releaseFirst: (() => void) | undefined;
    const holdFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const ensureOutputReady = vi.fn(async (plan: OrganizePlan) => {
      if (ensureOutputReady.mock.calls.length === 1) {
        markFirstStarted?.();
        await holdFirst;
      }
      return plan;
    });
    const { scraper, mocks } = createScraper(aggregate, {
      ensureOutputReady,
    });

    const firstPromise = scraper.scrapeFile("/tmp/FC2-123456-1.mp4", { fileIndex: 1, totalFiles: 2 });
    await firstStarted;

    const secondPromise = scraper.scrapeFile("/tmp/FC2-123456-2.mp4", { fileIndex: 2, totalFiles: 2 });
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(mocks.ensureOutputReady).toHaveBeenCalledTimes(1);

    releaseFirst?.();

    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first.status).toBe("success");
    expect(second.status).toBe("success");
    expect(mocks.ensureOutputReady).toHaveBeenCalledTimes(2);
  });

  it("reports failed results at the failed-folder path after moving the source video", async () => {
    const root = await createTempDir();
    const sourcePath = join(root, "FC2-123456.mp4");
    await writeFile(sourcePath, "video", "utf8");

    const aggregate = vi.fn().mockResolvedValue(null);
    const { scraper, mocks } = createScraper(aggregate, {
      moveToFailedFolder: vi.fn(async () => join(root, "failed", "FC2-123456.mp4")),
    });

    const result = await scraper.scrapeFile(sourcePath, { fileIndex: 1, totalFiles: 1 });

    expect(result).toMatchObject({
      status: "failed",
      fileInfo: {
        filePath: join(root, "failed", "FC2-123456.mp4"),
      },
    });
    expect(mocks.moveToFailedFolder).toHaveBeenCalledTimes(1);
  });
});
