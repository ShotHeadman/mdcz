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
import * as scraperOutput from "@main/services/scraper/output";
import type { TranslateService } from "@main/services/scraper/TranslateService";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData, FileInfo } from "@mdcz/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockConfigManager } from "./helpers";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-file-scraper-subs-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const config = configurationSchema.parse({
  ...defaultConfiguration,
  download: {
    ...defaultConfiguration.download,
    generateNfo: true,
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

describe("FileScraper subtitle sidecars", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map((dirPath) => rm(dirPath, { recursive: true, force: true })),
    );
  });

  const createScraper = (plan: OrganizePlan, writeNfo: ReturnType<typeof vi.fn>) => {
    mockConfigManager(config);
    vi.spyOn(scraperOutput, "probeVideoMetadataOrWarn").mockResolvedValue({
      durationSeconds: 120,
      width: 1920,
      height: 1080,
      bitrate: 1_000_000,
    });
    return createFileScraper({
      aggregationService: {
        aggregate: vi.fn().mockResolvedValue(createAggregationResult(createCrawlerData())),
      } as unknown as AggregationService,
      translateService: {
        translateCrawlerData: vi.fn(async (data: CrawlerData) => data),
      } as unknown as TranslateService,
      nfoGenerator: {
        writeNfo,
      } as unknown as NfoGenerator,
      downloadManager: {
        downloadAll: vi.fn().mockResolvedValue({
          downloaded: [],
          sceneImages: [],
        }),
      } as unknown as DownloadManager,
      fileOrganizer: {
        plan: vi.fn((_fileInfo: FileInfo) => plan),
        ensureOutputReady: vi.fn(async (nextPlan: OrganizePlan) => nextPlan),
        organizeVideo: vi.fn(async (_fileInfo: FileInfo, nextPlan: OrganizePlan) => nextPlan.targetVideoPath),
      } as unknown as FileOrganizer,
      signalService: new SignalService(null),
    });
  };

  it.each([
    ["ABC-123.mp4", "ABC-123.srt", "字幕"],
    ["ABC-123.mp4", "ABC-123.zh.srt", "中文字幕"],
    ["ABC-123-U.mp4", "ABC-123.zh.srt", "中文字幕"],
  ] as const)("propagates %s for %s into the merged subtitle tag", async (videoFileName, subtitleFileName, expectedSubtitleTag) => {
    const root = await createTempDir();
    const videoPath = join(root, videoFileName);
    const subtitlePath = join(root, subtitleFileName);
    const outputDir = join(root, "output", "ABC-123");
    const plan: OrganizePlan = {
      outputDir,
      targetVideoPath: join(outputDir, "ABC-123.mp4"),
      nfoPath: join(outputDir, "ABC-123.nfo"),
    };

    await writeFile(videoPath, "video");
    await writeFile(subtitlePath, "subtitle");

    const writeNfo = vi.fn().mockResolvedValue(plan.nfoPath);
    const scraper = createScraper(plan, writeNfo);

    const result = await scraper.scrapeFile(videoPath, { fileIndex: 1, totalFiles: 1 });
    const nfoOptions = writeNfo.mock.calls[0]?.[2] as { fileInfo?: FileInfo } | undefined;

    expect(result.status).toBe("success");
    expect(result.fileInfo.isSubtitled).toBe(true);
    expect(result.fileInfo.subtitleTag).toBe(expectedSubtitleTag);
    expect(nfoOptions?.fileInfo?.isSubtitled).toBe(true);
    expect(nfoOptions?.fileInfo?.subtitleTag).toBe(expectedSubtitleTag);
  });
});
