import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { ActorImageService } from "@main/services/ActorImageService";
import type { Configuration } from "@main/services/config";
import { configurationSchema } from "@main/services/config";
import type { ConfigManager } from "@main/services/config/ConfigManager";
import { loggerService } from "@main/services/LoggerService";
import type { SignalService } from "@main/services/SignalService";
import { pathExists } from "@main/utils/file";
import { parseFileInfo } from "@main/utils/number";
import { probeVideoMetadata } from "@main/utils/video";
import type { CrawlerData, FileInfo, ScrapeResult, VideoMeta } from "@shared/types";
import type { AggregationService } from "./aggregation";
import type { DownloadManager } from "./DownloadManager";
import type { FileOrganizer } from "./FileOrganizer";
import type { NfoGenerator } from "./NfoGenerator";
import type { TranslateService } from "./TranslateService";

export interface FileScraperDependencies {
  configManager: ConfigManager;
  aggregationService: AggregationService;
  translateService: TranslateService;
  nfoGenerator: NfoGenerator;
  downloadManager: DownloadManager;
  fileOrganizer: FileOrganizer;
  signalService: SignalService;
  actorImageService?: ActorImageService;
}

export interface FileScrapeProgress {
  fileIndex: number;
  totalFiles: number;
}

export class FileScraper {
  private readonly logger = loggerService.getLogger("FileScraper");

  private readonly actorImageService: ActorImageService;

  constructor(private readonly deps: FileScraperDependencies) {
    this.actorImageService = deps.actorImageService ?? new ActorImageService();
  }

  async scrapeFile(
    filePath: string,
    progress: FileScrapeProgress = { fileIndex: 1, totalFiles: 1 },
    signal?: AbortSignal,
  ): Promise<ScrapeResult> {
    const taskId = randomUUID();
    const fileInfo = parseFileInfo(filePath);

    this.deps.signalService.showLogText(`Starting scrape task ${taskId} for ${fileInfo.fileName}`);
    this.setProgress(progress, 0);

    try {
      const configuration = configurationSchema.parse(await this.deps.configManager.get());

      this.deps.signalService.showScrapeInfo({
        fileInfo,
        site: configuration.scrape.enabledSites[0],
        step: "search",
      });

      const aggregationResult = await this.deps.aggregationService.aggregate(fileInfo.number, configuration, signal);

      if (!aggregationResult) {
        this.setProgress(progress, 100);
        await this.handleFailedFileMove(fileInfo, configuration);
        const failedResult: ScrapeResult = {
          fileInfo,
          status: "failed",
          error: "No crawler returned metadata",
        };
        this.deps.signalService.showScrapeResult(failedResult);
        this.deps.signalService.showFailedInfo({ fileInfo, error: "No crawler returned metadata" });
        return failedResult;
      }

      const crawlerData: CrawlerData = aggregationResult.data;
      let videoMeta: VideoMeta | undefined;

      try {
        videoMeta = await probeVideoMetadata(fileInfo.filePath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Video probe failed: ${message}`);
      }

      this.setProgress(progress, 30);
      let plan = this.deps.fileOrganizer.plan(fileInfo, crawlerData, configuration);
      plan = await this.deps.fileOrganizer.ensureOutputReady(plan, fileInfo.filePath);

      const translated = await this.deps.translateService.translateCrawlerData(crawlerData, configuration);
      this.setProgress(progress, 50);

      this.deps.signalService.showScrapeInfo({
        fileInfo,
        site: translated.website,
        step: "download",
      });

      const assets = await this.deps.downloadManager.downloadAll(
        plan.outputDir,
        translated,
        configuration,
        aggregationResult.imageAlternatives,
        {
          onSceneProgress: (downloaded, total) => {
            this.deps.signalService.showLogText(`[${fileInfo.number}] Scene images: ${downloaded}/${total}`);
          },
        },
      );
      this.setProgress(progress, 75);

      let preparedData = translated;
      let savedNfoPath: string | undefined;
      if (configuration.download.downloadNfo) {
        if (configuration.download.keepNfo && (await pathExists(plan.nfoPath))) {
          savedNfoPath = plan.nfoPath;
        } else {
          const actorProfiles = await this.actorImageService.prepareActorProfilesForMovie(configuration, {
            movieDir: plan.outputDir,
            actors: translated.actors,
            actorProfiles: translated.actor_profiles,
            actorPhotoBaseDir: dirname(fileInfo.filePath),
          });
          preparedData = {
            ...translated,
            actor_profiles: actorProfiles,
          };
          savedNfoPath = await this.deps.nfoGenerator.writeNfo(plan.nfoPath, preparedData, {
            assets,
            sources: aggregationResult.sources,
            videoMeta,
          });
        }
      }
      this.setProgress(progress, 80);

      this.deps.signalService.showScrapeInfo({
        fileInfo,
        site: preparedData.website,
        step: "organize",
      });

      const outputVideoPath = await this.deps.fileOrganizer.organizeVideo(fileInfo, plan, configuration);

      this.setProgress(progress, 100);

      const result: ScrapeResult = {
        fileInfo: {
          ...fileInfo,
          filePath: outputVideoPath,
        },
        status: "success",
        crawlerData: preparedData,
        videoMeta,
        outputPath: plan.outputDir,
        nfoPath: savedNfoPath,
        assets,
        sources: aggregationResult.sources,
      };

      this.deps.signalService.showScrapeResult(result);

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Scrape failed for ${fileInfo.filePath}: ${message}`);
      this.setProgress(progress, 100);

      try {
        const cfg = configurationSchema.parse(await this.deps.configManager.get());
        await this.handleFailedFileMove(fileInfo, cfg);
      } catch (moveError) {
        const moveMsg = moveError instanceof Error ? moveError.message : String(moveError);
        this.logger.warn(`Failed to move file to failed folder: ${moveMsg}`);
      }

      const failedResult: ScrapeResult = {
        fileInfo,
        status: "failed",
        error: message,
      };
      this.deps.signalService.showScrapeResult(failedResult);
      this.deps.signalService.showFailedInfo({ fileInfo, error: message });
      return failedResult;
    }
  }

  private setProgress(progress: FileScrapeProgress, stepPercent: number): void {
    const normalizedPercent = Math.max(0, Math.min(100, stepPercent));
    const fileIndex = Math.max(1, progress.fileIndex);
    const totalFiles = Math.max(1, progress.totalFiles);
    const globalValue = (fileIndex - 1 + normalizedPercent / 100) / totalFiles;
    const value = Math.max(0, Math.min(100, Math.round(globalValue * 100)));

    this.deps.signalService.setProgress(value, fileIndex, totalFiles);
  }

  private async handleFailedFileMove(fileInfo: FileInfo, config: Configuration): Promise<void> {
    if (!config.behavior.failedFileMove) return;
    try {
      await this.deps.fileOrganizer.moveToFailedFolder(fileInfo, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to move file to failed folder: ${message}`);
    }
  }
}
