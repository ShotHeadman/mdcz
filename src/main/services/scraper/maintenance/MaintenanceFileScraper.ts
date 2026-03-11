import type { Configuration } from "@main/services/config/models";
import { loggerService } from "@main/services/LoggerService";
import { probeVideoMetadata } from "@main/utils/video";
import type {
  CrawlerData,
  DownloadedAssets,
  FieldDiff,
  LocalScanEntry,
  PathDiff,
  ScrapeResult,
  VideoMeta,
} from "@shared/types";
import type { ImageAlternatives, SourceMap } from "../aggregation/types";
import type { OrganizePlan } from "../FileOrganizer";
import type { FileScrapeProgress, FileScraperDependencies } from "../FileScraper";
import { diffCrawlerData } from "./diffCrawlerData";
import { diffPaths } from "./diffPaths";
import type { MaintenancePreset } from "./presets";

export interface MaintenanceProcessResult {
  scrapeResult: ScrapeResult;
  fieldDiffs?: FieldDiff[];
  pathDiff?: PathDiff;
}

export class MaintenanceFileScraper {
  private readonly logger = loggerService.getLogger("MaintenanceFileScraper");

  constructor(
    private readonly deps: FileScraperDependencies,
    private readonly preset: MaintenancePreset,
  ) {}

  async processFile(
    entry: LocalScanEntry,
    config: Configuration,
    progress: FileScrapeProgress = { fileIndex: 1, totalFiles: 1 },
    signal?: AbortSignal,
  ): Promise<MaintenanceProcessResult> {
    const { fileInfo } = entry;
    const { steps } = this.preset;
    this.logger.info(`[${this.preset.id}] Processing ${fileInfo.number} (${fileInfo.fileName})`);
    this.setProgress(progress, 0);

    try {
      // Step 1: Obtain CrawlerData (network or local NFO)
      let crawlerData: CrawlerData | undefined;
      let fieldDiffs: FieldDiff[] | undefined;
      let aggregationSources: SourceMap | undefined;
      let imageAlternatives: Partial<ImageAlternatives> = {};

      if (steps.aggregate) {
        this.deps.signalService.showLogText(`[${fileInfo.number}] 联网获取元数据...`);
        const aggregationResult = await this.deps.aggregationService.aggregate(fileInfo.number, config, signal);

        if (!aggregationResult) {
          return this.buildFailedResult(entry, "联网获取元数据失败：无数据返回");
        }

        crawlerData = aggregationResult.data;
        aggregationSources = aggregationResult.sources;
        imageAlternatives = aggregationResult.imageAlternatives;

        // Compute field diffs if we have local NFO data to compare against
        if (entry.crawlerData) {
          fieldDiffs = diffCrawlerData(entry.crawlerData, crawlerData);
        }
      } else {
        crawlerData = entry.crawlerData; // undefined when no NFO exists
      }

      this.setProgress(progress, 30);

      // Step 2: Translate (if enabled)
      if (steps.translate) {
        if (!crawlerData) {
          return this.buildFailedResult(entry, "无元数据可供翻译");
        }
        this.deps.signalService.showLogText(`[${fileInfo.number}] 翻译元数据...`);
        crawlerData = await this.deps.translateService.translateCrawlerData(crawlerData, config);
      }

      this.setProgress(progress, 50);

      // Step 3: Plan output paths (only when a write step is active)
      const needsPlan = steps.download || steps.generateNfo || steps.organize;
      let plan: OrganizePlan | undefined;
      let pathDiff: PathDiff | undefined;

      if (needsPlan) {
        if (!crawlerData) {
          return this.buildFailedResult(entry, "本地 NFO 不存在或无法解析，无法执行后续步骤");
        }
        plan = this.deps.fileOrganizer.plan(fileInfo, crawlerData, config);
        pathDiff = diffPaths(entry, plan);
        await this.deps.fileOrganizer.ensureOutputReady(plan, fileInfo.filePath);
      }

      // Step 4: Download assets (if enabled)
      let assets: DownloadedAssets = {
        thumb: entry.assets.thumb,
        poster: entry.assets.poster,
        fanart: entry.assets.fanart,
        sceneImages: entry.assets.sceneImages,
        trailer: entry.assets.trailer,
        downloaded: [],
      };

      if (steps.download && plan && crawlerData) {
        this.deps.signalService.showLogText(`[${fileInfo.number}] 下载资源...`);
        assets = await this.deps.downloadManager.downloadAll(plan.outputDir, crawlerData, config, imageAlternatives, {
          onSceneProgress: (downloaded, total) => {
            this.deps.signalService.showLogText(`[${fileInfo.number}] 场景图: ${downloaded}/${total}`);
          },
        });
      }

      this.setProgress(progress, 75);

      // Step 5: Generate NFO (if enabled)
      let savedNfoPath: string | undefined;
      if (steps.generateNfo && plan && crawlerData) {
        this.deps.signalService.showLogText(`[${fileInfo.number}] 生成 NFO...`);
        let videoMeta: VideoMeta | undefined;
        try {
          videoMeta = await probeVideoMetadata(fileInfo.filePath);
        } catch {
          this.logger.warn(`Video probe failed for ${fileInfo.filePath}`);
        }
        savedNfoPath = await this.deps.nfoGenerator.writeNfo(plan.nfoPath, crawlerData, {
          assets,
          sources: aggregationSources,
          videoMeta,
        });
      }

      this.setProgress(progress, 80);

      // Step 6: Organize files (if enabled)
      let outputVideoPath = fileInfo.filePath;
      if (steps.organize && plan) {
        this.deps.signalService.showLogText(`[${fileInfo.number}] 整理文件...`);
        outputVideoPath = await this.deps.fileOrganizer.organizeVideo(fileInfo, plan, config);
      }

      this.setProgress(progress, 100);

      const result: ScrapeResult = {
        fileInfo: { ...fileInfo, filePath: outputVideoPath },
        status: "success",
        crawlerData,
        outputPath: plan?.outputDir,
        nfoPath: savedNfoPath ?? entry.nfoPath,
        assets,
      };

      return { scrapeResult: result, fieldDiffs, pathDiff };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Maintenance failed for ${fileInfo.filePath}: ${message}`);
      this.setProgress(progress, 100);
      return this.buildFailedResult(entry, message);
    }
  }

  private buildFailedResult(entry: LocalScanEntry, error: string): MaintenanceProcessResult {
    return {
      scrapeResult: {
        fileInfo: entry.fileInfo,
        status: "failed",
        error,
      },
    };
  }

  private setProgress(progress: FileScrapeProgress, stepPercent: number): void {
    const normalizedPercent = Math.max(0, Math.min(100, stepPercent));
    const fileIndex = Math.max(1, progress.fileIndex);
    const totalFiles = Math.max(1, progress.totalFiles);
    const globalValue = (fileIndex - 1 + normalizedPercent / 100) / totalFiles;
    const value = Math.max(0, Math.min(100, Math.round(globalValue * 100)));

    this.deps.signalService.setProgress(value, fileIndex, totalFiles);
  }
}
