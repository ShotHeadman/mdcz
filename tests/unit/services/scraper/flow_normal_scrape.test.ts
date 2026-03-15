/**
 * 正常刮削流程验证
 *
 * 用 ABF-075（标准番号）和 EBWH-241（多 token 番号）端到端跑 FileScraper.scrapeFile()，
 * 验证完整流水线各步骤的执行顺序、数据流转和边界行为。
 *
 * 不依赖已有测试的假设，从头独立追踪逻辑。
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { SignalService } from "@main/services/SignalService";
import type { AggregationService } from "@main/services/scraper/aggregation";
import type { AggregationResult } from "@main/services/scraper/aggregation/types";
import type { DownloadManager } from "@main/services/scraper/DownloadManager";
import type { FileOrganizer, OrganizePlan } from "@main/services/scraper/FileOrganizer";
import { FileScraper } from "@main/services/scraper/FileScraper";
import type { NfoGenerator } from "@main/services/scraper/NfoGenerator";
import type { TranslateService } from "@main/services/scraper/TranslateService";
import { extractNumber, parseFileInfo } from "@main/utils/number";
import { Website } from "@shared/enums";
import type { CrawlerData, DownloadedAssets } from "@shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestConfigManager } from "./helpers";

// ── Test fixtures ────────────────────────────────────────────────

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-flow-normal-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const makeCrawlerData = (number: string, overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: `テストタイトル ${number}`,
  number,
  actors: ["女優A", "女優B"],
  genres: ["ジャンルX", "ジャンルY"],
  studio: "スタジオZ",
  publisher: "メーカーW",
  release_date: "2024-06-15",
  thumb_url: `https://img.example.com/${number}/thumb.jpg`,
  poster_url: `https://img.example.com/${number}/poster.jpg`,
  sample_images: [`https://img.example.com/${number}/scene-01.jpg`, `https://img.example.com/${number}/scene-02.jpg`],
  website: Website.DMM,
  ...overrides,
});

const makeAggregationResult = (data: CrawlerData): AggregationResult => ({
  data,
  sources: { title: Website.DMM, thumb_url: Website.DMM },
  imageAlternatives: {
    thumb_url: [],
    poster_url: [],
    sample_images: [],
  },
  stats: {
    totalSites: 1,
    successCount: 1,
    failedCount: 0,
    skippedCount: 0,
    siteResults: [],
    totalElapsedMs: 10,
  },
});

const makeDownloadedAssets = (outputDir: string): DownloadedAssets => ({
  thumb: join(outputDir, "thumb.jpg"),
  poster: join(outputDir, "poster.jpg"),
  sceneImages: [join(outputDir, "extrafanart", "scene-001.jpg")],
  downloaded: [join(outputDir, "thumb.jpg"), join(outputDir, "poster.jpg")],
});

// ── Tests ────────────────────────────────────────────────────────

describe("正常刮削 E2E 流程验证", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempDirs.splice(0, tempDirs.length).map((d) => rm(d, { recursive: true, force: true })));
  });

  // ──────────────────────────────────────────────────────────────
  // 1. 番号解析单元验证
  // ──────────────────────────────────────────────────────────────

  describe("番号解析", () => {
    it("ABF-075.mp4 → number=ABF-075", () => {
      const info = parseFileInfo("/media/ABF-075.mp4");
      expect(info.number).toBe("ABF-075");
      expect(info.extension).toBe(".mp4");
      expect(info.fileName).toBe("ABF-075");
    });

    it("[EBWH-241] some.title.mp4 → number=EBWH-241", () => {
      const info = parseFileInfo("/media/[EBWH-241] some.title.mp4");
      expect(info.number).toBe("EBWH-241");
    });

    it("EBWH-241-C.mp4 → number=EBWH-241, isSubtitled=true", () => {
      const info = parseFileInfo("/media/EBWH-241-C.mp4");
      expect(info.number).toBe("EBWH-241");
      expect(info.isSubtitled).toBe(true);
    });

    it("ABF-075-4K.mp4 → 4K token 被剥离，number 仍为 ABF-075", () => {
      const extracted = extractNumber("ABF-075-4K.");
      expect(extracted).toBe("ABF-075");
    });

    it("带分集号 ABF-075-CD1.mp4 → partNumber=1", () => {
      const info = parseFileInfo("/media/ABF-075-CD1.mp4");
      expect(info.partNumber).toBe(1);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 2. 完整流水线：ABF-075 成功路径
  // ──────────────────────────────────────────────────────────────

  describe("ABF-075 完整成功路径", () => {
    it("scrapeFile 走完全部步骤并返回 success", async () => {
      const root = await createTempDir();
      const outputDir = join(root, "JAV_output", "女優A 女優B", "ABF-075");
      const sourceFile = join(root, "ABF-075.mp4");
      await mkdir(root, { recursive: true });
      await writeFile(sourceFile, "video-data");

      const plan: OrganizePlan = {
        outputDir,
        targetVideoPath: join(outputDir, "ABF-075.mp4"),
        nfoPath: join(outputDir, "ABF-075.nfo"),
      };

      const crawlerData = makeCrawlerData("ABF-075");
      const aggregateResult = makeAggregationResult(crawlerData);
      const downloadedAssets = makeDownloadedAssets(outputDir);

      // Spy on each pipeline step
      const aggregateFn = vi.fn().mockResolvedValue(aggregateResult);
      const translateFn = vi.fn(async (data: CrawlerData) => data);
      const planFn = vi.fn().mockReturnValue(plan);
      const ensureOutputFn = vi.fn().mockImplementation(async (p: OrganizePlan) => p);
      const downloadAllFn = vi.fn().mockResolvedValue(downloadedAssets);
      const writeNfoFn = vi.fn().mockResolvedValue(plan.nfoPath);
      const organizeVideoFn = vi.fn().mockResolvedValue(plan.targetVideoPath);
      const signalService = new SignalService(null);
      const showScrapeInfoSpy = vi.spyOn(signalService, "showScrapeInfo");
      const setProgressSpy = vi.spyOn(signalService, "setProgress");

      const config = configurationSchema.parse({
        ...defaultConfiguration,
        translate: { ...defaultConfiguration.translate, enableTranslation: false },
      });

      const scraper = new FileScraper({
        configManager: new TestConfigManager(config),
        aggregationService: { aggregate: aggregateFn } as unknown as AggregationService,
        translateService: { translateCrawlerData: translateFn } as unknown as TranslateService,
        nfoGenerator: { writeNfo: writeNfoFn } as unknown as NfoGenerator,
        downloadManager: { downloadAll: downloadAllFn } as unknown as DownloadManager,
        fileOrganizer: {
          plan: planFn,
          ensureOutputReady: ensureOutputFn,
          organizeVideo: organizeVideoFn,
        } as unknown as FileOrganizer,
        signalService,
      });

      const result = await scraper.scrapeFile(sourceFile, { fileIndex: 1, totalFiles: 3 });

      // ── Step 1: 聚合被调用，传入解析出的 number ──
      expect(aggregateFn).toHaveBeenCalledTimes(1);
      expect(aggregateFn.mock.calls[0][0]).toBe("ABF-075");

      // ── Step 2: 翻译被调用 ──
      expect(translateFn).toHaveBeenCalledTimes(1);
      const translatedData = translateFn.mock.calls[0][0] as CrawlerData;
      expect(translatedData.number).toBe("ABF-075");

      // ── Step 3: 文件组织计划 ──
      expect(planFn).toHaveBeenCalledTimes(1);
      expect(ensureOutputFn).toHaveBeenCalledTimes(1);

      // ── Step 4: 下载 ──
      expect(downloadAllFn).toHaveBeenCalledTimes(1);
      const downloadDir = downloadAllFn.mock.calls[0][0] as string;
      expect(downloadDir).toBe(outputDir);

      // ── Step 5: NFO 生成 ──
      expect(writeNfoFn).toHaveBeenCalledTimes(1);
      const [nfoPath, nfoData] = writeNfoFn.mock.calls[0] as [string, CrawlerData];
      expect(nfoPath).toBe(plan.nfoPath);
      expect(nfoData.number).toBe("ABF-075");

      // ── Step 6: 视频移动 ──
      expect(organizeVideoFn).toHaveBeenCalledTimes(1);

      // ── 最终结果 ──
      expect(result.status).toBe("success");
      expect(result.fileInfo.filePath).toBe(plan.targetVideoPath);
      expect(result.crawlerData?.number).toBe("ABF-075");
      expect(result.outputPath).toBe(outputDir);
      expect(result.nfoPath).toBe(plan.nfoPath);
      expect(result.assets).toEqual(downloadedAssets);
      expect(result.sources).toEqual(aggregateResult.sources);

      // ── Signal 步骤顺序验证 ──
      // showScrapeInfo 应有 3 次调用（search, download, organize）
      expect(showScrapeInfoSpy).toHaveBeenCalledTimes(3);
      const scrapeSteps = showScrapeInfoSpy.mock.calls.map((c) => (c[0] as { step: string }).step);
      expect(scrapeSteps).toEqual(["search", "download", "organize"]);

      // 全局进度 = round((fileIndex-1 + stepPercent/100) / totalFiles * 100)
      // fileIndex=1, totalFiles=3:
      //   step=0%   → (0+0.00)/3=0.0000 → 0
      //   step=30%  → (0+0.30)/3=0.1000 → 10
      //   step=50%  → (0+0.50)/3=0.1667 → 17
      //   step=75%  → (0+0.75)/3=0.2500 → 25
      //   step=80%  → (0+0.80)/3=0.2667 → 27
      //   step=100% → (0+1.00)/3=0.3333 → 33
      const progressValues = setProgressSpy.mock.calls.map((c) => c[0] as number);
      expect(progressValues).toEqual([0, 10, 17, 25, 27, 33]);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 3. 完整流水线：EBWH-241 成功路径
  // ──────────────────────────────────────────────────────────────

  describe("EBWH-241 完整成功路径", () => {
    it("scrapeFile 正确传递 EBWH-241 编号并完成全部步骤", async () => {
      const root = await createTempDir();
      const outputDir = join(root, "output", "EBWH-241");
      const sourceFile = join(root, "[EBWH-241] SomeTitle.mp4");
      await mkdir(root, { recursive: true });
      await writeFile(sourceFile, "video-data");

      const plan: OrganizePlan = {
        outputDir,
        targetVideoPath: join(outputDir, "EBWH-241.mp4"),
        nfoPath: join(outputDir, "EBWH-241.nfo"),
      };

      const crawlerData = makeCrawlerData("EBWH-241");
      const aggregateResult = makeAggregationResult(crawlerData);

      const aggregateFn = vi.fn().mockResolvedValue(aggregateResult);
      const translateFn = vi.fn(async (data: CrawlerData) => data);
      const writeNfoFn = vi.fn().mockResolvedValue(plan.nfoPath);

      const config = configurationSchema.parse({ ...defaultConfiguration });

      const scraper = new FileScraper({
        configManager: new TestConfigManager(config),
        aggregationService: { aggregate: aggregateFn } as unknown as AggregationService,
        translateService: { translateCrawlerData: translateFn } as unknown as TranslateService,
        nfoGenerator: { writeNfo: writeNfoFn } as unknown as NfoGenerator,
        downloadManager: {
          downloadAll: vi.fn().mockResolvedValue({
            downloaded: [],
            sceneImages: [],
          }),
        } as unknown as DownloadManager,
        fileOrganizer: {
          plan: vi.fn().mockReturnValue(plan),
          ensureOutputReady: vi.fn().mockImplementation(async (p: OrganizePlan) => p),
          organizeVideo: vi.fn().mockResolvedValue(plan.targetVideoPath),
        } as unknown as FileOrganizer,
        signalService: new SignalService(null),
      });

      const result = await scraper.scrapeFile(sourceFile, { fileIndex: 1, totalFiles: 1 });

      expect(aggregateFn.mock.calls[0][0]).toBe("EBWH-241");
      expect(result.status).toBe("success");
      expect(result.crawlerData?.number).toBe("EBWH-241");
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 4. 聚合失败：返回 null → failed 路径
  // ──────────────────────────────────────────────────────────────

  describe("聚合失败路径", () => {
    it("聚合返回 null 时返回 failed 并调用 showFailedInfo", async () => {
      const root = await createTempDir();
      const sourceFile = join(root, "ABF-075.mp4");
      await writeFile(sourceFile, "data");

      const signalService = new SignalService(null);
      const showFailedInfoSpy = vi.spyOn(signalService, "showFailedInfo");
      const showScrapeResultSpy = vi.spyOn(signalService, "showScrapeResult");

      const config = configurationSchema.parse({
        ...defaultConfiguration,
        behavior: { ...defaultConfiguration.behavior, failedFileMove: false },
      });

      const scraper = new FileScraper({
        configManager: new TestConfigManager(config),
        aggregationService: {
          aggregate: vi.fn().mockResolvedValue(null),
        } as unknown as AggregationService,
        translateService: {
          translateCrawlerData: vi.fn(async (d: CrawlerData) => d),
        } as unknown as TranslateService,
        nfoGenerator: { writeNfo: vi.fn() } as unknown as NfoGenerator,
        downloadManager: { downloadAll: vi.fn() } as unknown as DownloadManager,
        fileOrganizer: {
          plan: vi.fn(),
          ensureOutputReady: vi.fn(),
          organizeVideo: vi.fn(),
          moveToFailedFolder: vi.fn(),
        } as unknown as FileOrganizer,
        signalService,
      });

      const result = await scraper.scrapeFile(sourceFile, { fileIndex: 1, totalFiles: 1 });

      expect(result.status).toBe("failed");
      expect(result.error).toBe("No crawler returned metadata");
      expect(showFailedInfoSpy).toHaveBeenCalledTimes(1);
      expect(showScrapeResultSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 5. keepNfo=true 且 NFO 已存在 → 不重新生成
  // ──────────────────────────────────────────────────────────────

  describe("keepNfo 行为", () => {
    it("keepNfo=true 且文件已存在时跳过 writeNfo", async () => {
      const root = await createTempDir();
      const outputDir = join(root, "output", "ABF-075");
      const sourceFile = join(root, "ABF-075.mp4");
      await mkdir(outputDir, { recursive: true });
      await writeFile(sourceFile, "video-data");
      // 预先创建 NFO 文件
      const nfoPath = join(outputDir, "ABF-075.nfo");
      await writeFile(nfoPath, "<movie><title>old</title></movie>");

      const plan: OrganizePlan = { outputDir, targetVideoPath: join(outputDir, "ABF-075.mp4"), nfoPath };

      const config = configurationSchema.parse({
        ...defaultConfiguration,
        download: { ...defaultConfiguration.download, keepNfo: true },
      });
      const writeNfoFn = vi.fn();

      const scraper = new FileScraper({
        configManager: new TestConfigManager(config),
        aggregationService: {
          aggregate: vi.fn().mockResolvedValue(makeAggregationResult(makeCrawlerData("ABF-075"))),
        } as unknown as AggregationService,
        translateService: {
          translateCrawlerData: vi.fn(async (d: CrawlerData) => d),
        } as unknown as TranslateService,
        nfoGenerator: { writeNfo: writeNfoFn } as unknown as NfoGenerator,
        downloadManager: {
          downloadAll: vi.fn().mockResolvedValue({ downloaded: [], sceneImages: [] }),
        } as unknown as DownloadManager,
        fileOrganizer: {
          plan: vi.fn().mockReturnValue(plan),
          ensureOutputReady: vi.fn().mockImplementation(async (p: OrganizePlan) => p),
          organizeVideo: vi.fn().mockResolvedValue(plan.targetVideoPath),
        } as unknown as FileOrganizer,
        signalService: new SignalService(null),
      });

      const result = await scraper.scrapeFile(sourceFile, { fileIndex: 1, totalFiles: 1 });

      expect(result.status).toBe("success");
      // keepNfo=true 且文件已存在 → writeNfo 不被调用
      expect(writeNfoFn).not.toHaveBeenCalled();
      // nfoPath 仍被设置为已有文件路径
      expect(result.nfoPath).toBe(nfoPath);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 6. 异常抛出 → catch 块处理
  // ──────────────────────────────────────────────────────────────

  describe("异常处理", () => {
    it("aggregation 抛出异常时不阻断、返回 failed 并记录错误", async () => {
      const root = await createTempDir();
      const sourceFile = join(root, "ABF-075.mp4");
      await writeFile(sourceFile, "data");

      const config = configurationSchema.parse({
        ...defaultConfiguration,
        behavior: { ...defaultConfiguration.behavior, failedFileMove: false },
      });

      const scraper = new FileScraper({
        configManager: new TestConfigManager(config),
        aggregationService: {
          aggregate: vi.fn().mockRejectedValue(new Error("network error")),
        } as unknown as AggregationService,
        translateService: {
          translateCrawlerData: vi.fn(),
        } as unknown as TranslateService,
        nfoGenerator: { writeNfo: vi.fn() } as unknown as NfoGenerator,
        downloadManager: { downloadAll: vi.fn() } as unknown as DownloadManager,
        fileOrganizer: {
          plan: vi.fn(),
          ensureOutputReady: vi.fn(),
          organizeVideo: vi.fn(),
          moveToFailedFolder: vi.fn(),
        } as unknown as FileOrganizer,
        signalService: new SignalService(null),
      });

      const result = await scraper.scrapeFile(sourceFile, { fileIndex: 1, totalFiles: 1 });

      expect(result.status).toBe("failed");
      expect(result.error).toBe("network error");
    });

    it("翻译抛出异常时降级继续后续步骤", async () => {
      const root = await createTempDir();
      const outputDir = join(root, "output", "ABF-075");
      const sourceFile = join(root, "ABF-075.mp4");
      await writeFile(sourceFile, "data");

      const plan: OrganizePlan = {
        outputDir,
        targetVideoPath: join(outputDir, "ABF-075.mp4"),
        nfoPath: join(outputDir, "ABF-075.nfo"),
      };

      const originalData = makeCrawlerData("ABF-075");
      const downloadAllFn = vi.fn().mockResolvedValue({ downloaded: [], sceneImages: [] });

      const scraper = new FileScraper({
        configManager: new TestConfigManager(configurationSchema.parse(defaultConfiguration)),
        aggregationService: {
          aggregate: vi.fn().mockResolvedValue(makeAggregationResult(originalData)),
        } as unknown as AggregationService,
        translateService: {
          translateCrawlerData: vi.fn().mockRejectedValue(new Error("translate unavailable")),
        } as unknown as TranslateService,
        nfoGenerator: { writeNfo: vi.fn().mockResolvedValue(plan.nfoPath) } as unknown as NfoGenerator,
        downloadManager: { downloadAll: downloadAllFn } as unknown as DownloadManager,
        fileOrganizer: {
          plan: vi.fn().mockReturnValue(plan),
          ensureOutputReady: vi.fn().mockImplementation(async (p: OrganizePlan) => p),
          organizeVideo: vi.fn().mockResolvedValue(plan.targetVideoPath),
        } as unknown as FileOrganizer,
        signalService: new SignalService(null),
      });

      const result = await scraper.scrapeFile(sourceFile, { fileIndex: 1, totalFiles: 1 });

      expect(result.status).toBe("success");
      expect(downloadAllFn).toHaveBeenCalledTimes(1);
      expect((downloadAllFn.mock.calls[0]?.[1] as CrawlerData).title).toBe(originalData.title);
      expect(result.crawlerData?.title).toBe(originalData.title);
    });

    it("中止进行中的下载时返回 skipped 且不发 failed 事件", async () => {
      const root = await createTempDir();
      const outputDir = join(root, "output", "ABF-075");
      const sourceFile = join(root, "ABF-075.mp4");
      await writeFile(sourceFile, "data");

      const plan: OrganizePlan = {
        outputDir,
        targetVideoPath: join(outputDir, "ABF-075.mp4"),
        nfoPath: join(outputDir, "ABF-075.nfo"),
      };

      const controller = new AbortController();
      const signalService = new SignalService(null);
      const showFailedInfoSpy = vi.spyOn(signalService, "showFailedInfo");
      const writeNfoFn = vi.fn();
      const organizeVideoFn = vi.fn();
      const downloadAllFn = vi
        .fn()
        .mockImplementation(
          async (
            _outputDir: string,
            _data: CrawlerData,
            _config: ReturnType<typeof configurationSchema.parse>,
            _imageAlternatives: unknown,
            callbacks?: { signal?: AbortSignal },
          ) => {
            return await new Promise((_, reject) => {
              callbacks?.signal?.addEventListener(
                "abort",
                () => {
                  const error = new Error("Operation aborted");
                  error.name = "AbortError";
                  reject(error);
                },
                { once: true },
              );
              queueMicrotask(() => controller.abort());
            });
          },
        );

      const scraper = new FileScraper({
        configManager: new TestConfigManager(configurationSchema.parse(defaultConfiguration)),
        aggregationService: {
          aggregate: vi.fn().mockResolvedValue(makeAggregationResult(makeCrawlerData("ABF-075"))),
        } as unknown as AggregationService,
        translateService: {
          translateCrawlerData: vi.fn(async (d: CrawlerData) => d),
        } as unknown as TranslateService,
        nfoGenerator: { writeNfo: writeNfoFn } as unknown as NfoGenerator,
        downloadManager: { downloadAll: downloadAllFn } as unknown as DownloadManager,
        fileOrganizer: {
          plan: vi.fn().mockReturnValue(plan),
          ensureOutputReady: vi.fn().mockImplementation(async (p: OrganizePlan) => p),
          organizeVideo: organizeVideoFn,
        } as unknown as FileOrganizer,
        signalService,
      });

      const result = await scraper.scrapeFile(sourceFile, { fileIndex: 1, totalFiles: 1 }, controller.signal);

      expect(result.status).toBe("skipped");
      expect(downloadAllFn.mock.calls[0]?.[4]?.signal).toBe(controller.signal);
      expect(showFailedInfoSpy).not.toHaveBeenCalled();
      expect(writeNfoFn).not.toHaveBeenCalled();
      expect(organizeVideoFn).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 7. 进度计算验证
  // ──────────────────────────────────────────────────────────────

  describe("进度计算逻辑", () => {
    it("fileIndex=2, totalFiles=4 时全局进度正确", async () => {
      const root = await createTempDir();
      const outputDir = join(root, "output");
      const sourceFile = join(root, "EBWH-241.mp4");
      await writeFile(sourceFile, "data");

      const plan: OrganizePlan = {
        outputDir,
        targetVideoPath: join(outputDir, "EBWH-241.mp4"),
        nfoPath: join(outputDir, "EBWH-241.nfo"),
      };

      const signalService = new SignalService(null);
      const setProgressSpy = vi.spyOn(signalService, "setProgress");

      const config = configurationSchema.parse({ ...defaultConfiguration });

      const scraper = new FileScraper({
        configManager: new TestConfigManager(config),
        aggregationService: {
          aggregate: vi.fn().mockResolvedValue(makeAggregationResult(makeCrawlerData("EBWH-241"))),
        } as unknown as AggregationService,
        translateService: {
          translateCrawlerData: vi.fn(async (d: CrawlerData) => d),
        } as unknown as TranslateService,
        nfoGenerator: { writeNfo: vi.fn().mockResolvedValue(plan.nfoPath) } as unknown as NfoGenerator,
        downloadManager: {
          downloadAll: vi.fn().mockResolvedValue({ downloaded: [], sceneImages: [] }),
        } as unknown as DownloadManager,
        fileOrganizer: {
          plan: vi.fn().mockReturnValue(plan),
          ensureOutputReady: vi.fn().mockImplementation(async (p: OrganizePlan) => p),
          organizeVideo: vi.fn().mockResolvedValue(plan.targetVideoPath),
        } as unknown as FileOrganizer,
        signalService,
      });

      await scraper.scrapeFile(sourceFile, { fileIndex: 2, totalFiles: 4 });

      // globalValue = (fileIndex - 1 + stepPercent / 100) / totalFiles
      // step=0%   → (1 + 0.00) / 4 = 0.25 → 25
      // step=30%  → (1 + 0.30) / 4 = 0.325 → 33
      // step=50%  → (1 + 0.50) / 4 = 0.375 → 38
      // step=75%  → (1 + 0.75) / 4 = 0.4375 → 44
      // step=80%  → (1 + 0.80) / 4 = 0.45 → 45
      // step=100% → (1 + 1.00) / 4 = 0.50 → 50
      const progressValues = setProgressSpy.mock.calls.map((c) => c[0] as number);
      expect(progressValues).toEqual([25, 33, 38, 44, 45, 50]);

      // 验证 fileIndex 和 totalFiles 也正确传递
      for (const call of setProgressSpy.mock.calls) {
        expect(call[1]).toBe(2); // fileIndex
        expect(call[2]).toBe(4); // totalFiles
      }
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 8. 翻译关闭时数据透传
  // ──────────────────────────────────────────────────────────────

  describe("翻译关闭时透传", () => {
    it("enableTranslation=false 时 translateCrawlerData 仍被调用但原样返回", async () => {
      const root = await createTempDir();
      const outputDir = join(root, "output");
      const sourceFile = join(root, "ABF-075.mp4");
      await writeFile(sourceFile, "data");

      const plan: OrganizePlan = {
        outputDir,
        targetVideoPath: join(outputDir, "ABF-075.mp4"),
        nfoPath: join(outputDir, "ABF-075.nfo"),
      };

      const originalData = makeCrawlerData("ABF-075");
      const translateFn = vi.fn(async (data: CrawlerData) => {
        // 真实的 translateCrawlerData，当 enableTranslation=false 时直接返回原始 data
        return data;
      });

      const config = configurationSchema.parse({
        ...defaultConfiguration,
        translate: { ...defaultConfiguration.translate, enableTranslation: false },
      });

      const scraper = new FileScraper({
        configManager: new TestConfigManager(config),
        aggregationService: {
          aggregate: vi.fn().mockResolvedValue(makeAggregationResult(originalData)),
        } as unknown as AggregationService,
        translateService: { translateCrawlerData: translateFn } as unknown as TranslateService,
        nfoGenerator: { writeNfo: vi.fn().mockResolvedValue(plan.nfoPath) } as unknown as NfoGenerator,
        downloadManager: {
          downloadAll: vi.fn().mockResolvedValue({ downloaded: [], sceneImages: [] }),
        } as unknown as DownloadManager,
        fileOrganizer: {
          plan: vi.fn().mockReturnValue(plan),
          ensureOutputReady: vi.fn().mockImplementation(async (p: OrganizePlan) => p),
          organizeVideo: vi.fn().mockResolvedValue(plan.targetVideoPath),
        } as unknown as FileOrganizer,
        signalService: new SignalService(null),
      });

      const result = await scraper.scrapeFile(sourceFile, { fileIndex: 1, totalFiles: 1 });

      expect(result.status).toBe("success");
      expect(translateFn).toHaveBeenCalledTimes(1);
      // 翻译应接收到聚合返回的 crawlerData
      const inputToTranslate = translateFn.mock.calls[0][0] as CrawlerData;
      expect(inputToTranslate.title).toBe(originalData.title);
      expect(inputToTranslate.number).toBe("ABF-075");
    });
  });
});
