import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { SignalService } from "@main/services/SignalService";
import type { AggregationResult } from "@main/services/scraper/aggregation";
import type { OrganizePlan } from "@main/services/scraper/FileOrganizer";
import type { FileScraperDependencies } from "@main/services/scraper/FileScraper";
import { AggregateStage } from "@main/services/scraper/pipeline/AggregateStage";
import { DefaultFileScraperPipeline } from "@main/services/scraper/pipeline/DefaultFileScraperPipeline";
import { PlanStage } from "@main/services/scraper/pipeline/PlanStage";
import { ProbeStage } from "@main/services/scraper/pipeline/ProbeStage";
import { ScrapeContext } from "@main/services/scraper/pipeline/ScrapeContext";
import { TranslateStage } from "@main/services/scraper/pipeline/TranslateStage";
import type { FileScraperStageRuntime } from "@main/services/scraper/pipeline/types";
import { Website } from "@shared/enums";
import type { CrawlerData, FileInfo } from "@shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

const config = configurationSchema.parse(defaultConfiguration);
const tempDirs: string[] = [];

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

const createPipeline = () =>
  new DefaultFileScraperPipeline({
    aggregationService: {
      aggregate: vi.fn(),
    } as unknown as FileScraperDependencies["aggregationService"],
    translateService: {
      translateCrawlerData: vi.fn(),
    } as unknown as FileScraperDependencies["translateService"],
    nfoGenerator: {
      writeNfo: vi.fn(),
    } as unknown as FileScraperDependencies["nfoGenerator"],
    downloadManager: {
      downloadAll: vi.fn(),
    } as unknown as FileScraperDependencies["downloadManager"],
    fileOrganizer: {
      plan: vi.fn(),
      ensureOutputReady: vi.fn(),
      organizeVideo: vi.fn(),
      moveToFailedFolder: vi.fn(),
    } as unknown as FileScraperDependencies["fileOrganizer"],
    signalService: new SignalService(null),
  });

describe("FileScraper pipeline stages", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map((dirPath) => rm(dirPath, { recursive: true, force: true })),
    );
  });

  it("orders ProbeStage ahead of AggregateStage", () => {
    const pipeline = createPipeline();

    expect(pipeline.stages.map((stage) => stage.constructor.name)).toEqual([
      "ParseStage",
      "ProbeStage",
      "AggregateStage",
      "TranslateStage",
      "PlanStage",
      "PrepareOutputStage",
      "DownloadStage",
      "NfoStage",
      "OrganizeStage",
    ]);
  });

  it("ProbeStage keeps invalid non-STRM files in the pipeline and only records missing metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "mdcz-probe-stage-"));
    tempDirs.push(root);
    const invalidVideoPath = join(root, "ABC-123.mp4");
    await writeFile(invalidVideoPath, "not-a-video", "utf8");
    const runtime = createRuntime();
    const context = new ScrapeContext(invalidVideoPath);

    await new ProbeStage(runtime).execute(context);

    expect(runtime.getConfiguration).not.toHaveBeenCalled();
    expect(runtime.handleFailedFileMove).not.toHaveBeenCalled();
    expect(runtime.signalService.showScrapeResult).not.toHaveBeenCalled();
    expect(runtime.signalService.showFailedInfo).not.toHaveBeenCalled();
    expect(context.videoMeta).toBeUndefined();
    expect(context.result).toBeUndefined();
    expect(runtime.setProgress).toHaveBeenCalledWith(context.progress, 30);
  });

  it("ProbeStage avoids loading configuration when probing succeeds", async () => {
    const runtime = createRuntime();
    const context = new ScrapeContext("/tmp/ABC-123.mp4");

    await new ProbeStage(runtime).execute(context);

    expect(runtime.getConfiguration).not.toHaveBeenCalled();
  });

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
      {
        executionMode: "batch",
      },
    );
    expect(context.plan).toEqual({
      ...basePlan,
      subtitleSidecars: context.subtitleSidecars,
    });
  });
});
