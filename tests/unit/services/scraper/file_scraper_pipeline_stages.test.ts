import { configurationSchema, defaultConfiguration } from "@main/services/config";
import type { AggregationResult } from "@main/services/scraper/aggregation";
import type { OrganizePlan } from "@main/services/scraper/FileOrganizer";
import { AggregateStage } from "@main/services/scraper/pipeline/AggregateStage";
import { PlanStage } from "@main/services/scraper/pipeline/PlanStage";
import { ScrapeContext } from "@main/services/scraper/pipeline/ScrapeContext";
import { TranslateStage } from "@main/services/scraper/pipeline/TranslateStage";
import type { FileScraperStageRuntime } from "@main/services/scraper/pipeline/types";
import { Website } from "@shared/enums";
import type { CrawlerData, FileInfo } from "@shared/types";
import { describe, expect, it, vi } from "vitest";

const config = configurationSchema.parse(defaultConfiguration);

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Sample Title",
  number: "ABC-123",
  actors: [],
  genres: [],
  scene_images: [],
  website: Website.DMM,
  ...overrides,
});

const createAggregationResult = (data: CrawlerData): AggregationResult => ({
  data,
  sources: {},
  imageAlternatives: {
    thumb_url: [],
    poster_url: [],
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

const createRuntime = (overrides: Partial<FileScraperStageRuntime> = {}): FileScraperStageRuntime => ({
  actorImageService: {} as FileScraperStageRuntime["actorImageService"],
  downloadManager: {} as FileScraperStageRuntime["downloadManager"],
  fileOrganizer: {
    plan: vi.fn(),
    ensureOutputReady: vi.fn(async (plan: OrganizePlan) => plan),
    organizeVideo: vi.fn(),
    moveToFailedFolder: vi.fn(),
  } as unknown as FileScraperStageRuntime["fileOrganizer"],
  logger: {
    warn: vi.fn(),
  } as FileScraperStageRuntime["logger"],
  nfoGenerator: {} as FileScraperStageRuntime["nfoGenerator"],
  signalService: {
    showFailedInfo: vi.fn(),
    showLogText: vi.fn(),
    showScrapeInfo: vi.fn(),
    showScrapeResult: vi.fn(),
    setProgress: vi.fn(),
  },
  getConfiguration: vi.fn().mockResolvedValue(config),
  aggregateMetadata: vi.fn().mockResolvedValue(createAggregationResult(createCrawlerData())),
  handleFailedFileMove: vi.fn(async (fileInfo: FileInfo) => fileInfo),
  loadExistingNfoLocalState: vi.fn().mockResolvedValue(undefined),
  setProgress: vi.fn(),
  translateCrawlerData: vi.fn(async (crawlerData: CrawlerData) => crawlerData),
  ...overrides,
});

describe("FileScraper pipeline stages", () => {
  it("AggregateStage materializes a failed result when aggregation has no metadata", async () => {
    const movedFileInfo: FileInfo = {
      filePath: "/tmp/failed/ABC-123.mp4",
      fileName: "ABC-123.mp4",
      extension: ".mp4",
      number: "ABC-123",
      isSubtitled: false,
    };
    const runtime = createRuntime({
      aggregateMetadata: vi.fn().mockResolvedValue(null),
      handleFailedFileMove: vi.fn().mockResolvedValue(movedFileInfo),
    });
    const context = new ScrapeContext("/tmp/ABC-123.mp4");

    await new AggregateStage(runtime).execute(context);

    expect(runtime.handleFailedFileMove).toHaveBeenCalledWith(
      expect.objectContaining({ number: "ABC-123" }),
      expect.any(Object),
    );
    expect(runtime.signalService.showScrapeResult).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error: "No crawler returned metadata",
        fileInfo: movedFileInfo,
      }),
    );
    expect(context.result).toMatchObject({
      status: "failed",
      fileInfo: movedFileInfo,
    });
  });

  it("TranslateStage writes translated crawler data back into the context", async () => {
    const aggregated = createCrawlerData();
    const translated = createCrawlerData({
      title_zh: "翻译标题",
    });
    const runtime = createRuntime({
      translateCrawlerData: vi.fn().mockResolvedValue(translated),
    });
    const context = new ScrapeContext("/tmp/ABC-123.mp4");
    context.configuration = config;
    context.aggregationResult = createAggregationResult(aggregated);

    await new TranslateStage(runtime).execute(context);

    expect(runtime.translateCrawlerData).toHaveBeenCalledWith(aggregated, config, undefined);
    expect(context.translatedCrawlerData).toEqual(translated);
  });

  it("PlanStage carries subtitle sidecars into the prepared organize plan", async () => {
    const basePlan: OrganizePlan = {
      outputDir: "/output/ABC-123",
      targetVideoPath: "/output/ABC-123/ABC-123.mp4",
      nfoPath: "/output/ABC-123/ABC-123.nfo",
    };
    const runtime = createRuntime({
      fileOrganizer: {
        plan: vi.fn().mockReturnValue(basePlan),
        ensureOutputReady: vi.fn(async (plan: OrganizePlan) => plan),
        organizeVideo: vi.fn(),
        moveToFailedFolder: vi.fn(),
      } as unknown as FileScraperStageRuntime["fileOrganizer"],
    });
    const context = new ScrapeContext("/tmp/ABC-123.mp4");
    context.configuration = config;
    context.translatedCrawlerData = createCrawlerData({
      title_zh: "翻译标题",
    });
    context.subtitleSidecars = [
      {
        path: "/tmp/ABC-123.zh.srt",
        suffix: ".zh",
        subtitleTag: "中文字幕",
      },
    ];

    await new PlanStage(runtime).execute(context);

    expect(runtime.fileOrganizer.plan).toHaveBeenCalledWith(
      expect.objectContaining({ number: "ABC-123" }),
      context.translatedCrawlerData,
      config,
      undefined,
    );
    expect(context.plan).toEqual({
      ...basePlan,
      subtitleSidecars: context.subtitleSidecars,
    });
  });
});
