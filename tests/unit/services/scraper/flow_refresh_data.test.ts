/**
 * 刷新数据流程验证
 *
 * 用 ABF-075 和 EBWH-241 模拟已有本地扫描条目（LocalScanEntry），
 * 通过 MaintenanceFileScraper + refresh_data 预设端到端跑 processFile()，
 * 验证 diff 计算、图片刷新逻辑、committed 模式、资产迁移等行为。
 *
 * 不依赖已有测试的假设，从头独立追踪逻辑。
 */

import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Configuration, configurationSchema, defaultConfiguration } from "@main/services/config";
import type { DeepPartial } from "@main/services/config/models";
import { SignalService } from "@main/services/SignalService";
import type { AggregationService } from "@main/services/scraper/aggregation";
import type { AggregationResult } from "@main/services/scraper/aggregation/types";
import type { DownloadManager } from "@main/services/scraper/DownloadManager";
import type { FileOrganizer, OrganizePlan } from "@main/services/scraper/FileOrganizer";
import { partitionCrawlerDataWithOptions } from "@main/services/scraper/maintenance/diffCrawlerData";
import { diffPaths } from "@main/services/scraper/maintenance/diffPaths";
import { MaintenanceFileScraper } from "@main/services/scraper/maintenance/MaintenanceFileScraper";
import { MAINTENANCE_PRESETS, type MaintenancePreset } from "@main/services/scraper/maintenance/presets";
import type { NfoGenerator } from "@main/services/scraper/NfoGenerator";
import type { TranslateService } from "@main/services/scraper/TranslateService";
import { parseFileInfo } from "@main/utils/number";
import { Website } from "@shared/enums";
import type { CrawlerData, DiscoveredAssets, DownloadedAssets, LocalScanEntry } from "@shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestConfigManager } from "./helpers";

// ── Test Fixtures ────────────────────────────────────────────────

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-flow-refresh-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const REFRESH_PRESET = MAINTENANCE_PRESETS.refresh_data;

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

const makeLocalCrawlerData = (number: string): CrawlerData => ({
  title: `旧タイトル ${number}`,
  number,
  actors: ["女優A"],
  genres: ["ジャンルX"],
  studio: "旧スタジオ",
  release_date: "2024-01-01",
  thumb_url: `https://old.example.com/${number}/thumb.jpg`,
  poster_url: `https://old.example.com/${number}/poster.jpg`,
  sample_images: [],
  website: Website.JAVBUS,
});

const makeAggregationResult = (data: CrawlerData): AggregationResult => ({
  data,
  sources: { title: Website.DMM, thumb_url: Website.DMM },
  imageAlternatives: {
    thumb_url: [`https://alt.example.com/${data.number}/thumb2.jpg`],
    poster_url: [],
    sample_images: [],
  },
  stats: {
    totalSites: 2,
    successCount: 2,
    failedCount: 0,
    skippedCount: 0,
    siteResults: [],
    totalElapsedMs: 50,
  },
});

const makeEntry = (
  number: string,
  dir: string,
  crawlerData?: CrawlerData,
  assets: Partial<DiscoveredAssets> = {},
): LocalScanEntry => ({
  id: randomUUID(),
  videoPath: join(dir, `${number}.mp4`),
  fileInfo: parseFileInfo(join(dir, `${number}.mp4`)),
  nfoPath: join(dir, `${number}.nfo`),
  crawlerData,
  assets: {
    thumb: assets.thumb ?? join(dir, "thumb.jpg"),
    poster: assets.poster ?? join(dir, "poster.jpg"),
    fanart: assets.fanart,
    sceneImages: assets.sceneImages ?? [],
    trailer: assets.trailer,
    nfo: assets.nfo ?? join(dir, `${number}.nfo`),
    actorPhotos: assets.actorPhotos ?? [],
  },
  currentDir: dir,
});

const mergePresetConfig = (preset: MaintenancePreset, base: Configuration): Configuration => {
  const overrides = preset.configOverrides as DeepPartial<Configuration>;
  const merged = { ...base };
  if (overrides.download) {
    merged.download = { ...merged.download, ...overrides.download };
  }
  if (overrides.behavior) {
    merged.behavior = { ...merged.behavior, ...overrides.behavior };
  }
  return merged;
};

// ── Tests ────────────────────────────────────────────────────────

describe("刷新数据 E2E 流程验证", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempDirs.splice(0, tempDirs.length).map((d) => rm(d, { recursive: true, force: true })));
  });

  // ──────────────────────────────────────────────────────────────
  // 1. 预设配置断言
  // ──────────────────────────────────────────────────────────────

  describe("refresh_data 预设配置", () => {
    it("所有步骤均启用", () => {
      expect(REFRESH_PRESET.steps).toEqual({
        aggregate: true,
        translate: true,
        download: true,
        generateNfo: true,
        organize: true,
      });
    });

    it("默认 keep 所有资源", () => {
      expect(REFRESH_PRESET.configOverrides.download).toMatchObject({
        keepThumb: true,
        keepPoster: true,
        keepFanart: true,
        keepSceneImages: true,
        keepTrailer: true,
        keepNfo: false, // NFO 固定重新生成
      });
    });

    it("不移动文件但重命名", () => {
      expect(REFRESH_PRESET.configOverrides.behavior).toMatchObject({
        successFileMove: false,
        successFileRename: true,
      });
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 2. ABF-075 完整刷新成功路径
  // ──────────────────────────────────────────────────────────────

  describe("ABF-075 刷新成功路径", () => {
    it("processFile 走完全部步骤，返回 success 及 diff 信息", async () => {
      const root = await createTempDir();
      const dir = join(root, "ABF-075");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "ABF-075.mp4"), "video");
      await writeFile(join(dir, "ABF-075.nfo"), "<movie><title>old</title></movie>");
      await writeFile(join(dir, "thumb.jpg"), "old-thumb");
      await writeFile(join(dir, "poster.jpg"), "old-poster");

      const oldData = makeLocalCrawlerData("ABF-075");
      const newData = makeCrawlerData("ABF-075");
      const entry = makeEntry("ABF-075", dir, oldData);

      const aggregateResult = makeAggregationResult(newData);
      const aggregateFn = vi.fn().mockResolvedValue(aggregateResult);
      const translateFn = vi.fn(async (data: CrawlerData) => data);
      const writeNfoFn = vi.fn().mockResolvedValue(join(dir, "ABF-075.nfo"));
      const downloadAllFn = vi.fn().mockResolvedValue({
        thumb: join(dir, "thumb.jpg"),
        poster: join(dir, "poster.jpg"),
        sceneImages: [],
        downloaded: [],
      } as DownloadedAssets);

      const plan: OrganizePlan = {
        outputDir: dir,
        targetVideoPath: join(dir, "ABF-075.mp4"),
        nfoPath: join(dir, "ABF-075.nfo"),
      };
      const planFn = vi.fn().mockReturnValue(plan);
      const resolveOutputFn = vi.fn().mockImplementation(async (p: OrganizePlan) => p);
      const organizeVideoFn = vi.fn().mockResolvedValue(join(dir, "ABF-075.mp4"));

      const signalService = new SignalService(null);
      const showLogTextSpy = vi.spyOn(signalService, "showLogText");

      const baseConfig = configurationSchema.parse({
        ...defaultConfiguration,
        translate: { ...defaultConfiguration.translate, enableTranslation: false },
      });
      const config = mergePresetConfig(REFRESH_PRESET, baseConfig);

      const fileScraper = new MaintenanceFileScraper(
        {
          configManager: new TestConfigManager(config),
          aggregationService: { aggregate: aggregateFn } as unknown as AggregationService,
          translateService: { translateCrawlerData: translateFn } as unknown as TranslateService,
          nfoGenerator: { writeNfo: writeNfoFn } as unknown as NfoGenerator,
          downloadManager: { downloadAll: downloadAllFn } as unknown as DownloadManager,
          fileOrganizer: {
            plan: planFn,
            resolveOutputPlan: resolveOutputFn,
            organizeVideo: organizeVideoFn,
          } as unknown as FileOrganizer,
          signalService,
        },
        REFRESH_PRESET,
      );

      const result = await fileScraper.processFile(entry, config, { fileIndex: 1, totalFiles: 1 });

      // ── 聚合 ──
      expect(aggregateFn).toHaveBeenCalledTimes(1);
      expect(aggregateFn.mock.calls[0][0]).toBe("ABF-075");

      // ── 翻译 ──
      expect(translateFn).toHaveBeenCalledTimes(1);

      // ── Diff: 应有变更的字段 ──
      expect(result.scrapeResult.status).toBe("success");
      expect(result.fieldDiffs).toBeDefined();
      expect(result.fieldDiffs?.length).toBeGreaterThan(0);

      // title 从 "旧タイトル" 变为 "テストタイトル" → 应在 fieldDiffs 中
      const titleDiff = result.fieldDiffs?.find((d) => d.field === "title");
      expect(titleDiff).toBeDefined();
      expect(titleDiff?.changed).toBe(true);
      expect(titleDiff?.oldValue).toBe(oldData.title);
      expect(titleDiff?.newValue).toBe(newData.title);

      // ── NFO 生成 ──
      expect(writeNfoFn).toHaveBeenCalledTimes(1);

      // ── 文件组织 ──
      expect(organizeVideoFn).toHaveBeenCalledTimes(1);

      // ── 日志输出 ──
      const logTexts = showLogTextSpy.mock.calls.map((c) => c[0] as string);
      expect(logTexts.some((t) => t.includes("ABF-075") && t.includes("Fetching metadata"))).toBe(true);

      // ── updatedEntry 生成 ──
      expect(result.updatedEntry).toBeDefined();
      expect(result.updatedEntry?.crawlerData?.title).toBe(newData.title);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 3. EBWH-241 刷新 + 图片 URL 变更 → 强制刷新
  // ──────────────────────────────────────────────────────────────

  describe("EBWH-241 图片 URL 变更 → forceReplace 逻辑", () => {
    it("thumb_url 变更时 downloadAll 收到 forceReplace.thumb=true 且 fanart=true", async () => {
      const root = await createTempDir();
      const dir = join(root, "EBWH-241");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "EBWH-241.mp4"), "video");
      await writeFile(join(dir, "thumb.jpg"), "old-thumb");

      const oldData = makeLocalCrawlerData("EBWH-241");
      // 新数据的 thumb_url 不同于旧数据
      const newData = makeCrawlerData("EBWH-241", {
        thumb_url: "https://new.example.com/EBWH-241/thumb-new.jpg",
      });
      const entry = makeEntry("EBWH-241", dir, oldData);

      const aggregateResult = makeAggregationResult(newData);
      const downloadAllFn = vi.fn().mockResolvedValue({
        thumb: join(dir, "thumb.jpg"),
        poster: join(dir, "poster.jpg"),
        sceneImages: [],
        downloaded: [join(dir, "thumb.jpg")],
      } as DownloadedAssets);

      const plan: OrganizePlan = {
        outputDir: dir,
        targetVideoPath: join(dir, "EBWH-241.mp4"),
        nfoPath: join(dir, "EBWH-241.nfo"),
      };

      const config = mergePresetConfig(REFRESH_PRESET, configurationSchema.parse({ ...defaultConfiguration }));

      const fileScraper = new MaintenanceFileScraper(
        {
          configManager: new TestConfigManager(config),
          aggregationService: {
            aggregate: vi.fn().mockResolvedValue(aggregateResult),
          } as unknown as AggregationService,
          translateService: {
            translateCrawlerData: vi.fn(async (data: CrawlerData) => data),
          } as unknown as TranslateService,
          nfoGenerator: {
            writeNfo: vi.fn().mockResolvedValue(plan.nfoPath),
          } as unknown as NfoGenerator,
          downloadManager: { downloadAll: downloadAllFn } as unknown as DownloadManager,
          fileOrganizer: {
            plan: vi.fn().mockReturnValue(plan),
            resolveOutputPlan: vi.fn().mockImplementation(async (p: OrganizePlan) => p),
            organizeVideo: vi.fn().mockResolvedValue(plan.targetVideoPath),
          } as unknown as FileOrganizer,
          signalService: new SignalService(null),
        },
        REFRESH_PRESET,
      );

      await fileScraper.processFile(entry, config, { fileIndex: 1, totalFiles: 1 });

      // 验证 downloadAll 收到了 forceReplace
      expect(downloadAllFn).toHaveBeenCalledTimes(1);
      const downloadCallbacks = downloadAllFn.mock.calls[0][4] as {
        forceReplace?: Partial<Record<"thumb" | "poster" | "fanart", boolean>>;
      };
      expect(downloadCallbacks.forceReplace?.thumb).toBe(true);
      // fanart 应跟随 thumb 强制刷新
      expect(downloadCallbacks.forceReplace?.fanart).toBe(true);
    });

    it("thumb_url 未变更时 forceReplace 不应包含 thumb", async () => {
      const root = await createTempDir();
      const dir = join(root, "EBWH-241");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "EBWH-241.mp4"), "video");

      // 新旧 thumb_url 相同
      const sameThumbUrl = "https://same.example.com/thumb.jpg";
      const oldData = makeLocalCrawlerData("EBWH-241");
      oldData.thumb_url = sameThumbUrl;
      const newData = makeCrawlerData("EBWH-241", { thumb_url: sameThumbUrl });
      const entry = makeEntry("EBWH-241", dir, oldData);

      const downloadAllFn = vi.fn().mockResolvedValue({
        thumb: join(dir, "thumb.jpg"),
        poster: join(dir, "poster.jpg"),
        sceneImages: [],
        downloaded: [],
      } as DownloadedAssets);

      const plan: OrganizePlan = {
        outputDir: dir,
        targetVideoPath: join(dir, "EBWH-241.mp4"),
        nfoPath: join(dir, "EBWH-241.nfo"),
      };

      const config = mergePresetConfig(REFRESH_PRESET, configurationSchema.parse({ ...defaultConfiguration }));

      const fileScraper = new MaintenanceFileScraper(
        {
          configManager: new TestConfigManager(config),
          aggregationService: {
            aggregate: vi.fn().mockResolvedValue(makeAggregationResult(newData)),
          } as unknown as AggregationService,
          translateService: {
            translateCrawlerData: vi.fn(async (data: CrawlerData) => data),
          } as unknown as TranslateService,
          nfoGenerator: {
            writeNfo: vi.fn().mockResolvedValue(plan.nfoPath),
          } as unknown as NfoGenerator,
          downloadManager: { downloadAll: downloadAllFn } as unknown as DownloadManager,
          fileOrganizer: {
            plan: vi.fn().mockReturnValue(plan),
            resolveOutputPlan: vi.fn().mockImplementation(async (p: OrganizePlan) => p),
            organizeVideo: vi.fn().mockResolvedValue(plan.targetVideoPath),
          } as unknown as FileOrganizer,
          signalService: new SignalService(null),
        },
        REFRESH_PRESET,
      );

      await fileScraper.processFile(entry, config, { fileIndex: 1, totalFiles: 1 });

      const downloadCallbacks = downloadAllFn.mock.calls[0][4] as {
        forceReplace?: Partial<Record<"thumb" | "poster" | "fanart", boolean>>;
      };
      expect(downloadCallbacks.forceReplace?.thumb).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 4. Committed 模式：跳过聚合，使用传入数据
  // ──────────────────────────────────────────────────────────────

  describe("Committed 模式", () => {
    it("传入 committed.crawlerData 时跳过 aggregate 和 translate", async () => {
      const root = await createTempDir();
      const dir = join(root, "ABF-075");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "ABF-075.mp4"), "video");

      const oldData = makeLocalCrawlerData("ABF-075");
      const committedData = makeCrawlerData("ABF-075", { title: "用户手动选择的标题" });
      const entry = makeEntry("ABF-075", dir, oldData);

      const aggregateFn = vi.fn();
      const writeNfoFn = vi.fn().mockResolvedValue(join(dir, "ABF-075.nfo"));

      const plan: OrganizePlan = {
        outputDir: dir,
        targetVideoPath: join(dir, "ABF-075.mp4"),
        nfoPath: join(dir, "ABF-075.nfo"),
      };

      const config = mergePresetConfig(REFRESH_PRESET, configurationSchema.parse({ ...defaultConfiguration }));

      const fileScraper = new MaintenanceFileScraper(
        {
          configManager: new TestConfigManager(config),
          aggregationService: { aggregate: aggregateFn } as unknown as AggregationService,
          translateService: {
            translateCrawlerData: vi.fn(async (data: CrawlerData) => data),
          } as unknown as TranslateService,
          nfoGenerator: { writeNfo: writeNfoFn } as unknown as NfoGenerator,
          downloadManager: {
            downloadAll: vi.fn().mockResolvedValue({ downloaded: [], sceneImages: [] }),
          } as unknown as DownloadManager,
          fileOrganizer: {
            plan: vi.fn().mockReturnValue(plan),
            resolveOutputPlan: vi.fn().mockImplementation(async (p: OrganizePlan) => p),
            organizeVideo: vi.fn().mockResolvedValue(plan.targetVideoPath),
          } as unknown as FileOrganizer,
          signalService: new SignalService(null),
        },
        REFRESH_PRESET,
      );

      const result = await fileScraper.processFile(entry, config, { fileIndex: 1, totalFiles: 1 }, undefined, {
        crawlerData: committedData,
        imageAlternatives: {},
      });

      // aggregate 不应被调用 → committed 模式走 prepareCommittedFile
      expect(aggregateFn).not.toHaveBeenCalled();
      expect(result.scrapeResult.status).toBe("success");
      // NFO 写入的数据应为 committed 数据
      const nfoData = writeNfoFn.mock.calls[0]?.[1] as CrawlerData;
      expect(nfoData.title).toBe("用户手动选择的标题");
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 5. Diff 计算：无旧 NFO 时构建空壳 baseline
  // ──────────────────────────────────────────────────────────────

  describe("Diff baseline 构建", () => {
    it("无旧 crawlerData 时 fieldDiffs 以空壳为基线", async () => {
      const root = await createTempDir();
      const dir = join(root, "ABF-075");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "ABF-075.mp4"), "video");

      // entry 没有 crawlerData（NFO 不存在或解析失败）
      const entry = makeEntry("ABF-075", dir, undefined);
      const newData = makeCrawlerData("ABF-075");

      const plan: OrganizePlan = {
        outputDir: dir,
        targetVideoPath: join(dir, "ABF-075.mp4"),
        nfoPath: join(dir, "ABF-075.nfo"),
      };

      const config = mergePresetConfig(REFRESH_PRESET, configurationSchema.parse({ ...defaultConfiguration }));

      const fileScraper = new MaintenanceFileScraper(
        {
          configManager: new TestConfigManager(config),
          aggregationService: {
            aggregate: vi.fn().mockResolvedValue(makeAggregationResult(newData)),
          } as unknown as AggregationService,
          translateService: {
            translateCrawlerData: vi.fn(async (data: CrawlerData) => data),
          } as unknown as TranslateService,
          nfoGenerator: {
            writeNfo: vi.fn().mockResolvedValue(plan.nfoPath),
          } as unknown as NfoGenerator,
          downloadManager: {
            downloadAll: vi.fn().mockResolvedValue({ downloaded: [], sceneImages: [] }),
          } as unknown as DownloadManager,
          fileOrganizer: {
            plan: vi.fn().mockReturnValue(plan),
            resolveOutputPlan: vi.fn().mockImplementation(async (p: OrganizePlan) => p),
            organizeVideo: vi.fn().mockResolvedValue(plan.targetVideoPath),
          } as unknown as FileOrganizer,
          signalService: new SignalService(null),
        },
        REFRESH_PRESET,
      );

      const result = await fileScraper.processFile(entry, config);

      expect(result.scrapeResult.status).toBe("success");
      // fieldDiffs 应存在且有值 → 从空壳对比到有值，很多字段"变更"
      expect(result.fieldDiffs).toBeDefined();
      expect(result.fieldDiffs?.length).toBeGreaterThan(0);

      // title: 空壳baseline的title=""，新值非空 → changed=true
      const titleDiff = result.fieldDiffs?.find((d) => d.field === "title");
      expect(titleDiff).toBeDefined();
      expect(titleDiff?.changed).toBe(true);
      expect(titleDiff?.oldValue).toBe(""); // 空壳 baseline
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 6. diffPaths 单元验证
  // ──────────────────────────────────────────────────────────────

  describe("diffPaths 路径变更检测", () => {
    it("路径未变更 → changed=false", () => {
      const dir = "/media/ABF-075";
      const entry = makeEntry("ABF-075", dir);
      const plan: OrganizePlan = {
        outputDir: dir,
        targetVideoPath: join(dir, "ABF-075.mp4"),
        nfoPath: join(dir, "ABF-075.nfo"),
      };

      const result = diffPaths(entry, plan);
      expect(result.changed).toBe(false);
      expect(result.currentDir).toBe(dir);
      expect(result.targetDir).toBe(dir);
    });

    it("路径变更 → changed=true", () => {
      const oldDir = "/media/old/ABF-075";
      const newDir = "/media/new/ABF-075";
      const entry = makeEntry("ABF-075", oldDir);
      const plan: OrganizePlan = {
        outputDir: newDir,
        targetVideoPath: join(newDir, "ABF-075.mp4"),
        nfoPath: join(newDir, "ABF-075.nfo"),
      };

      const result = diffPaths(entry, plan);
      expect(result.changed).toBe(true);
      expect(result.currentDir).toBe(oldDir);
      expect(result.targetDir).toBe(newDir);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 7. partitionCrawlerDataWithOptions 验证
  // ──────────────────────────────────────────────────────────────

  describe("Diff 分区：changed vs unchanged", () => {
    it("字段值相同 → 进入 unchangedFieldDiffs", () => {
      // 注意：sample_images 置空，因为 imageCollection diff 在无 entry 时
      // oldPreview.items=[] 而 newPreview.items=sample_images，会导致 changed=true
      const data = makeCrawlerData("ABF-075", { sample_images: [] });
      const { fieldDiffs, unchangedFieldDiffs } = partitionCrawlerDataWithOptions(data, data, {});

      // 完全相同的数据，所有字段应进入 unchanged
      expect(fieldDiffs.length).toBe(0);
      expect(unchangedFieldDiffs.length).toBeGreaterThan(0);
    });

    it("imageCollection：无 entry 时使用旧 sample_images 作为 preview 基线", () => {
      const data = makeCrawlerData("ABF-075"); // 带 sample_images
      const { fieldDiffs, unchangedFieldDiffs } = partitionCrawlerDataWithOptions(data, data, {});

      expect(fieldDiffs.find((d) => d.field === "sample_images")).toBeUndefined();
      const sceneDiff = unchangedFieldDiffs.find((d) => d.field === "sample_images");
      expect(sceneDiff).toBeDefined();
      if (sceneDiff?.kind === "imageCollection") {
        expect(sceneDiff.changed).toBe(false);
        expect(sceneDiff.oldPreview.items).toEqual(data.sample_images);
        expect(sceneDiff.newPreview.items).toEqual(data.sample_images);
      }
    });

    it("title 变更 → 进入 fieldDiffs, studio 不变 → 进入 unchangedFieldDiffs", () => {
      const oldData = makeCrawlerData("ABF-075", { title: "旧标题", studio: "相同制片" });
      const newData = makeCrawlerData("ABF-075", { title: "新标题", studio: "相同制片" });
      const { fieldDiffs, unchangedFieldDiffs } = partitionCrawlerDataWithOptions(oldData, newData, {});

      const titleDiff = fieldDiffs.find((d) => d.field === "title");
      expect(titleDiff).toBeDefined();
      expect(titleDiff?.changed).toBe(true);

      const studioDiff = unchangedFieldDiffs.find((d) => d.field === "studio");
      expect(studioDiff).toBeDefined();
      expect(studioDiff?.changed).toBe(false);
    });

    it("includeTranslatedFields=false 时跳过 title_zh 和 plot_zh", () => {
      const oldData = makeCrawlerData("ABF-075");
      const newData = makeCrawlerData("ABF-075", { title_zh: "新中文标题" });
      const { fieldDiffs, unchangedFieldDiffs } = partitionCrawlerDataWithOptions(oldData, newData, {
        includeTranslatedFields: false,
      });

      const allFields = [...fieldDiffs, ...unchangedFieldDiffs].map((d) => d.field);
      expect(allFields).not.toContain("title_zh");
      expect(allFields).not.toContain("plot_zh");
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 8. 聚合失败 → 抛出错误
  // ──────────────────────────────────────────────────────────────

  describe("聚合失败", () => {
    it("aggregate 返回 null 时 processFile 返回 failed", async () => {
      const root = await createTempDir();
      const dir = join(root, "EBWH-241");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "EBWH-241.mp4"), "video");

      const entry = makeEntry("EBWH-241", dir, makeLocalCrawlerData("EBWH-241"));

      const config = mergePresetConfig(REFRESH_PRESET, configurationSchema.parse({ ...defaultConfiguration }));

      const fileScraper = new MaintenanceFileScraper(
        {
          configManager: new TestConfigManager(config),
          aggregationService: {
            aggregate: vi.fn().mockResolvedValue(null),
          } as unknown as AggregationService,
          translateService: {
            translateCrawlerData: vi.fn(async (data: CrawlerData) => data),
          } as unknown as TranslateService,
          nfoGenerator: { writeNfo: vi.fn() } as unknown as NfoGenerator,
          downloadManager: { downloadAll: vi.fn() } as unknown as DownloadManager,
          fileOrganizer: {
            plan: vi.fn(),
            resolveOutputPlan: vi.fn(),
            organizeVideo: vi.fn(),
          } as unknown as FileOrganizer,
          signalService: new SignalService(null),
        },
        REFRESH_PRESET,
      );

      const result = await fileScraper.processFile(entry, config);

      expect(result.scrapeResult.status).toBe("failed");
      expect(result.scrapeResult.error).toContain("联网获取元数据失败");
    });

    it("翻译抛出异常时降级继续后续维护流程", async () => {
      const root = await createTempDir();
      const dir = join(root, "ABF-075");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "ABF-075.mp4"), "video");

      const entry = makeEntry("ABF-075", dir, makeLocalCrawlerData("ABF-075"));
      const newData = makeCrawlerData("ABF-075");
      const downloadAllFn = vi.fn().mockResolvedValue({ downloaded: [], sceneImages: [] });
      const plan: OrganizePlan = {
        outputDir: dir,
        targetVideoPath: join(dir, "ABF-075.mp4"),
        nfoPath: join(dir, "ABF-075.nfo"),
      };
      const config = mergePresetConfig(REFRESH_PRESET, configurationSchema.parse({ ...defaultConfiguration }));

      const fileScraper = new MaintenanceFileScraper(
        {
          configManager: new TestConfigManager(config),
          aggregationService: {
            aggregate: vi.fn().mockResolvedValue(makeAggregationResult(newData)),
          } as unknown as AggregationService,
          translateService: {
            translateCrawlerData: vi.fn().mockRejectedValue(new Error("translate unavailable")),
          } as unknown as TranslateService,
          nfoGenerator: {
            writeNfo: vi.fn().mockResolvedValue(plan.nfoPath),
          } as unknown as NfoGenerator,
          downloadManager: { downloadAll: downloadAllFn } as unknown as DownloadManager,
          fileOrganizer: {
            plan: vi.fn().mockReturnValue(plan),
            resolveOutputPlan: vi.fn().mockImplementation(async (p: OrganizePlan) => p),
            organizeVideo: vi.fn().mockResolvedValue(plan.targetVideoPath),
          } as unknown as FileOrganizer,
          signalService: new SignalService(null),
        },
        REFRESH_PRESET,
      );

      const result = await fileScraper.processFile(entry, config);

      expect(result.scrapeResult.status).toBe("success");
      expect((downloadAllFn.mock.calls[0]?.[1] as CrawlerData).title).toBe(newData.title);
      expect(result.updatedEntry?.crawlerData?.title).toBe(newData.title);
    });

    it("中止进行中的维护下载时返回 failed 并传递 signal", async () => {
      const root = await createTempDir();
      const dir = join(root, "ABF-075");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "ABF-075.mp4"), "video");

      const entry = makeEntry("ABF-075", dir, makeLocalCrawlerData("ABF-075"));
      const plan: OrganizePlan = {
        outputDir: dir,
        targetVideoPath: join(dir, "ABF-075.mp4"),
        nfoPath: join(dir, "ABF-075.nfo"),
      };
      const controller = new AbortController();
      const config = mergePresetConfig(REFRESH_PRESET, configurationSchema.parse({ ...defaultConfiguration }));

      const downloadAllFn = vi
        .fn()
        .mockImplementation(
          async (
            _outputDir: string,
            _data: CrawlerData,
            _config: Configuration,
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

      const fileScraper = new MaintenanceFileScraper(
        {
          configManager: new TestConfigManager(config),
          aggregationService: {
            aggregate: vi.fn().mockResolvedValue(makeAggregationResult(makeCrawlerData("ABF-075"))),
          } as unknown as AggregationService,
          translateService: {
            translateCrawlerData: vi.fn(async (data: CrawlerData) => data),
          } as unknown as TranslateService,
          nfoGenerator: { writeNfo: vi.fn() } as unknown as NfoGenerator,
          downloadManager: { downloadAll: downloadAllFn } as unknown as DownloadManager,
          fileOrganizer: {
            plan: vi.fn().mockReturnValue(plan),
            resolveOutputPlan: vi.fn().mockImplementation(async (p: OrganizePlan) => p),
            organizeVideo: vi.fn(),
          } as unknown as FileOrganizer,
          signalService: new SignalService(null),
        },
        REFRESH_PRESET,
      );

      const result = await fileScraper.processFile(entry, config, { fileIndex: 1, totalFiles: 1 }, controller.signal);

      expect(result.scrapeResult.status).toBe("failed");
      expect(result.scrapeResult.error).toBe("Operation aborted");
      expect(downloadAllFn.mock.calls[0]?.[4]?.signal).toBe(controller.signal);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 9. assetDecisions 验证
  // ──────────────────────────────────────────────────────────────

  describe("assetDecisions 传递", () => {
    it("committed 模式中 assetDecisions 正确传递给 downloadAll", async () => {
      const root = await createTempDir();
      const dir = join(root, "ABF-075");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "ABF-075.mp4"), "video");

      const entry = makeEntry("ABF-075", dir, makeLocalCrawlerData("ABF-075"));
      const committedData = makeCrawlerData("ABF-075");
      const downloadAllFn = vi.fn().mockResolvedValue({ downloaded: [], sceneImages: [] });

      const plan: OrganizePlan = {
        outputDir: dir,
        targetVideoPath: join(dir, "ABF-075.mp4"),
        nfoPath: join(dir, "ABF-075.nfo"),
      };

      const config = mergePresetConfig(REFRESH_PRESET, configurationSchema.parse({ ...defaultConfiguration }));

      const fileScraper = new MaintenanceFileScraper(
        {
          configManager: new TestConfigManager(config),
          aggregationService: { aggregate: vi.fn() } as unknown as AggregationService,
          translateService: {
            translateCrawlerData: vi.fn(async (data: CrawlerData) => data),
          } as unknown as TranslateService,
          nfoGenerator: {
            writeNfo: vi.fn().mockResolvedValue(plan.nfoPath),
          } as unknown as NfoGenerator,
          downloadManager: { downloadAll: downloadAllFn } as unknown as DownloadManager,
          fileOrganizer: {
            plan: vi.fn().mockReturnValue(plan),
            resolveOutputPlan: vi.fn().mockImplementation(async (p: OrganizePlan) => p),
            organizeVideo: vi.fn().mockResolvedValue(plan.targetVideoPath),
          } as unknown as FileOrganizer,
          signalService: new SignalService(null),
        },
        REFRESH_PRESET,
      );

      await fileScraper.processFile(entry, config, { fileIndex: 1, totalFiles: 1 }, undefined, {
        crawlerData: committedData,
        imageAlternatives: {},
        assetDecisions: { trailer: "replace", sceneImages: "preserve" },
      });

      const callbacks = downloadAllFn.mock.calls[0][4] as {
        assetDecisions?: { trailer?: string; sceneImages?: string };
      };
      expect(callbacks.assetDecisions?.trailer).toBe("replace");
      expect(callbacks.assetDecisions?.sceneImages).toBe("preserve");
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 10. refresh_data 下 successFileMove=false 验证
  // ──────────────────────────────────────────────────────────────

  describe("successFileMove=false 行为", () => {
    it("refresh_data 下 FileOrganizer.plan 接收到 successFileMove=false 的配置", async () => {
      const root = await createTempDir();
      const dir = join(root, "ABF-075");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "ABF-075.mp4"), "video");

      const entry = makeEntry("ABF-075", dir, makeLocalCrawlerData("ABF-075"));
      const newData = makeCrawlerData("ABF-075");

      const planFn = vi.fn().mockReturnValue({
        outputDir: dir,
        targetVideoPath: join(dir, "ABF-075.mp4"),
        nfoPath: join(dir, "ABF-075.nfo"),
      } as OrganizePlan);

      const config = mergePresetConfig(
        REFRESH_PRESET,
        configurationSchema.parse({
          ...defaultConfiguration,
          behavior: { ...defaultConfiguration.behavior, successFileMove: true },
        }),
      );

      // 确认 mergePresetConfig 覆盖了 successFileMove
      expect(config.behavior.successFileMove).toBe(false);

      const fileScraper = new MaintenanceFileScraper(
        {
          configManager: new TestConfigManager(config),
          aggregationService: {
            aggregate: vi.fn().mockResolvedValue(makeAggregationResult(newData)),
          } as unknown as AggregationService,
          translateService: {
            translateCrawlerData: vi.fn(async (data: CrawlerData) => data),
          } as unknown as TranslateService,
          nfoGenerator: {
            writeNfo: vi.fn().mockResolvedValue(join(dir, "ABF-075.nfo")),
          } as unknown as NfoGenerator,
          downloadManager: {
            downloadAll: vi.fn().mockResolvedValue({ downloaded: [], sceneImages: [] }),
          } as unknown as DownloadManager,
          fileOrganizer: {
            plan: planFn,
            resolveOutputPlan: vi.fn().mockImplementation(async (p: OrganizePlan) => p),
            organizeVideo: vi.fn().mockResolvedValue(join(dir, "ABF-075.mp4")),
          } as unknown as FileOrganizer,
          signalService: new SignalService(null),
        },
        REFRESH_PRESET,
      );

      await fileScraper.processFile(entry, config);

      // plan() 接收到的 config 包含 successFileMove=false
      expect(planFn).toHaveBeenCalledTimes(1);
      const passedConfig = planFn.mock.calls[0][2] as Configuration;
      expect(passedConfig.behavior.successFileMove).toBe(false);
    });
  });
});
