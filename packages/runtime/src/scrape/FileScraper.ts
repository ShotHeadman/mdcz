import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MediaRoot } from "@mdcz/media-store";
import type { Configuration } from "@mdcz/shared/config";
import type { Website } from "@mdcz/shared/enums";
import { toErrorMessage } from "@mdcz/shared/error";
import { buildFileId } from "@mdcz/shared/mediaIdentity";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type {
  CrawlerData,
  DownloadedAssets,
  FileInfo,
  NfoLocalState,
  ScrapeResult,
  VideoMeta,
} from "@mdcz/shared/types";
import {
  createPublicationPlan,
  type PreparedPublicationPlan,
  type PublicationPlan,
  toRootFileRef,
} from "../publication";
import type { RuntimeActorImageService, RuntimeActorSourceProvider } from "./actorOutput";
import type { AggregationResult, AggregationService, ManualScrapeOptions } from "./aggregation";
import { canonicalizeCrawlerDataActorAliases } from "./canonicalizeActorAliases";
import type { DownloadManager } from "./download";
import { type FileOrganizer, resolveMetadataOutputDir } from "./FileOrganizer";
import { isGeneratedSidecarVideo, resolveFileInfoWithSubtitles } from "./media";
import type { NfoGenerator, NfoOptions } from "./nfo";
import {
  downloadCrawlerAssets,
  organizePreparedVideo,
  prepareOutputCrawlerData,
  updateBatchProgress,
  writePreparedNfo,
} from "./output/executeOutputSteps";
import type { TranslateService } from "./TranslateService";
import { isAbortError, throwIfAborted } from "./utils/abort";
import { classifyMovie, isLikelyUncensoredNumber } from "./utils/movieClassification";
import { parseFileInfo } from "./utils/number";

export interface RuntimeScrapeSignalService {
  showFailedInfo(input: { fileInfo: FileInfo; error: string }): void;
  showLogText(message: string): void;
  showScrapeInfo(input: {
    fileInfo: FileInfo;
    site: Website;
    step: "search" | "download" | "parse" | "organize";
  }): void;
  showScrapeResult(result: ScrapeResult): void;
  setProgress(value: number, current: number, total: number): void;
}

export interface FileScraperDependencies {
  actorImageService: RuntimeActorImageService;
  actorSourceProvider?: RuntimeActorSourceProvider;
  aggregationService: Pick<AggregationService, "aggregate"> & {
    getFailureSummary?(number: string): string | undefined;
  };
  downloadManager: DownloadManager;
  fileOrganizer: FileOrganizer;
  getConfiguration(): Promise<Configuration>;
  loadExistingNfoLocalState?(filePath: string, configuration: Configuration): Promise<NfoLocalState | undefined>;
  logger: { info(message: string): void; warn(message: string): void; error(message: string): void };
  nfoGenerator: NfoGenerator;
  buildTags?: NfoOptions["buildTags"];
  postProcessAssets?(input: {
    assets: DownloadedAssets;
    configuration: Configuration;
    crawlerData: CrawlerData;
    fileInfo: FileInfo;
    localState?: NfoLocalState;
    signal?: AbortSignal;
  }): Promise<DownloadedAssets>;
  probeVideoMetadata?(sourcePath: string): Promise<VideoMeta | undefined>;
  signalService: RuntimeScrapeSignalService;
  translateService: Pick<TranslateService, "translateCrawlerData">;
}

export type ScrapeExecutionMode = "single" | "batch";

export interface FileScrapeProgress {
  fileIndex: number;
  totalFiles: number;
}

export type FileScrapeOptions = {
  manualScrape?: ManualScrapeOptions;
  scrapeSessionId?: string;
  source?: RootFileRef;
  roots?: readonly Pick<MediaRoot, "id" | "hostPath">[];
  operationId?: string;
};

export type FileScrapeResult = ScrapeResult & { publicationPlan?: PublicationPlan };

const toScrapeIdentity = (
  fileId: string,
  fileInfo: FileInfo,
  options: FileScrapeOptions,
): Pick<ScrapeResult, "fileId" | "rootId" | "relativePath" | "fileName" | "part" | "assets"> => ({
  fileId,
  rootId: options.source?.rootId ?? "local",
  relativePath: options.source?.relativePath ?? fileInfo.filePath,
  fileName: fileInfo.fileName,
  assets: [],
  ...(fileInfo.part ? { part: fileInfo.part } : {}),
});

export interface CreateFileScraperOptions {
  mode?: ScrapeExecutionMode;
  scrapeSessionId?: string;
}

const AGGREGATION_FAILURE_CACHE_WINDOW_MS = 1000;

export class FileScraper {
  private readonly aggregationPromises = new Map<string, Promise<AggregationResult | null>>();
  private readonly numberExecutionChains = new Map<string, Promise<void>>();

  constructor(
    private readonly deps: FileScraperDependencies,
    private readonly options: CreateFileScraperOptions = {},
  ) {}

  async scrapeFile(
    filePath: string,
    progress: FileScrapeProgress = { fileIndex: 1, totalFiles: 1 },
    signal?: AbortSignal,
    options: FileScrapeOptions = {},
  ): Promise<FileScrapeResult> {
    const configuration = await this.deps.getConfiguration();
    const parsedFileInfo = parseFileInfo(filePath, configuration.scrape.filenameIgnoreTokens);
    const fileId = buildFileId(parsedFileInfo.filePath);
    let fileInfo = parsedFileInfo;
    let stagingDir: string | undefined;
    this.deps.signalService.showScrapeResult({ ...toScrapeIdentity(fileId, fileInfo, options), status: "processing" });
    this.setProgress(progress, 0);

    const lockKey = fileInfo.number.trim().toUpperCase();
    const previous = this.numberExecutionChains.get(lockKey) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.catch(() => undefined).then(async () => await current);
    this.numberExecutionChains.set(lockKey, chain);
    await previous.catch(() => undefined);

    try {
      const resolved = await resolveFileInfoWithSubtitles(filePath, { parsedFileInfo });
      fileInfo = resolved.fileInfo;
      const videoMeta = await this.deps.probeVideoMetadata?.(fileInfo.filePath);
      this.setProgress(progress, 30);
      const existingNfoLocalState = await this.deps.loadExistingNfoLocalState?.(fileInfo.filePath, configuration);
      const scrapeSessionId = options.scrapeSessionId ?? this.options.scrapeSessionId;
      this.deps.signalService.showLogText(
        `Starting file scrape task ${randomUUID()} for ${fileInfo.fileName} (scrapeSessionId: ${scrapeSessionId ?? "standalone"})`,
      );
      throwIfAborted(signal);
      this.deps.signalService.showScrapeInfo({
        fileInfo,
        site: configuration.scrape.sites[0],
        step: "search",
      });

      const aggregationResult = await this.aggregate(fileInfo, configuration, signal, options.manualScrape);
      throwIfAborted(signal);
      if (!aggregationResult) {
        this.setProgress(progress, 100);
        const error =
          this.deps.aggregationService.getFailureSummary?.(fileInfo.number) ?? "No crawler returned metadata";
        const result: ScrapeResult = { ...toScrapeIdentity(fileId, fileInfo, options), status: "failed", error };
        this.deps.signalService.showScrapeResult(result);
        this.deps.signalService.showFailedInfo({ fileInfo, error });
        return result;
      }

      let crawlerData: CrawlerData;
      try {
        crawlerData = await this.deps.translateService.translateCrawlerData(
          aggregationResult.data,
          configuration,
          signal,
        );
      } catch (error) {
        if (isAbortError(error)) throw error;
        this.deps.logger.warn(`Translation failed for ${aggregationResult.data.number}: ${toErrorMessage(error)}`);
        crawlerData = aggregationResult.data;
      }
      throwIfAborted(signal);
      crawlerData = canonicalizeCrawlerDataActorAliases(crawlerData, configuration);

      const plan = await this.deps.fileOrganizer.resolveOutputPlan(
        {
          ...this.deps.fileOrganizer.plan(fileInfo, crawlerData, configuration, existingNfoLocalState, {
            executionMode: this.options.mode ?? "batch",
          }),
          subtitleSidecars: resolved.subtitleSidecars,
        },
        fileInfo.filePath,
      );
      throwIfAborted(signal);
      stagingDir = await mkdtemp(path.join(tmpdir(), "mdcz-publication-"));
      const metadataOutputDir = resolveMetadataOutputDir(plan);

      const prepared = await prepareOutputCrawlerData({
        actorImageService: this.deps.actorImageService,
        actorSourceProvider: this.deps.actorSourceProvider,
        config: configuration,
        crawlerData,
        enabled: true,
        movieDir: stagingDir,
        sourceVideoPath: fileInfo.filePath,
        signal,
      });
      crawlerData = prepared.data ?? crawlerData;
      throwIfAborted(signal);
      this.setProgress(progress, 50);

      this.deps.signalService.showScrapeInfo({ fileInfo, site: this.requireWebsite(crawlerData), step: "download" });
      const downloaded = await downloadCrawlerAssets({
        config: configuration,
        crawlerData,
        downloadManager: this.deps.downloadManager,
        fileInfo,
        imageAlternatives: aggregationResult.imageAlternatives,
        movieBaseName: path.basename(plan.nfoPath, ".nfo"),
        outputDir: stagingDir,
        sources: aggregationResult.sources,
        callbacks: { signal },
        onLog: (message) => this.deps.signalService.showLogText(message),
        postProcessAssets: this.deps.postProcessAssets
          ? async (assets, resolvedCrawlerData) =>
              (await this.deps.postProcessAssets?.({
                assets,
                configuration,
                crawlerData: resolvedCrawlerData,
                fileInfo,
                localState: existingNfoLocalState,
                signal,
              })) ?? assets
          : undefined,
      });
      crawlerData = downloaded.crawlerData;
      throwIfAborted(signal);
      this.setProgress(progress, 75);

      const toTargetPath = (stagedPath: string): string => {
        const relativePath = path.relative(stagingDir as string, stagedPath);
        if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
          throw new Error(`Staged publication artifact escaped its workspace: ${stagedPath}`);
        }
        return path.join(metadataOutputDir, relativePath);
      };
      const downloadedAssets = downloaded.assets ?? { sceneImages: [], downloaded: [] };
      const targetAssets: DownloadedAssets = {
        ...downloadedAssets,
        thumb: downloadedAssets.thumb ? toTargetPath(downloadedAssets.thumb) : undefined,
        poster: downloadedAssets.poster ? toTargetPath(downloadedAssets.poster) : undefined,
        fanart: downloadedAssets.fanart ? toTargetPath(downloadedAssets.fanart) : undefined,
        sceneImages: (downloadedAssets.sceneImages ?? []).map(toTargetPath),
        trailer: downloadedAssets.trailer ? toTargetPath(downloadedAssets.trailer) : undefined,
        downloaded: (downloadedAssets.downloaded ?? []).map(toTargetPath),
      };

      if (configuration.download.generateNfo) {
        this.deps.signalService.showLogText(`[${fileInfo.number}] Generating NFO...`);
      }
      const nfoArtifacts = new Map<string, string>();
      const savedNfoPath = await writePreparedNfo({
        assets: targetAssets,
        config: configuration,
        crawlerData,
        enabled: configuration.download.generateNfo,
        fileInfo,
        keepExisting: configuration.download.keepNfo,
        localState: existingNfoLocalState,
        nfoGenerator: this.deps.nfoGenerator,
        buildTags: this.deps.buildTags,
        nfoPath: plan.nfoPath,
        sourceVideoPath: fileInfo.filePath,
        sources: aggregationResult.sources,
        videoMeta,
        probeVideoMetadata: this.deps.probeVideoMetadata,
        writeFile: async (targetPath, content) => {
          nfoArtifacts.set(targetPath, content);
        },
      });
      this.deps.signalService.showScrapeInfo({ fileInfo, site: this.requireWebsite(crawlerData), step: "organize" });
      this.deps.signalService.showLogText(`[${fileInfo.number}] Organizing files...`);
      throwIfAborted(signal);
      const outputVideoPath = await organizePreparedVideo({
        config: configuration,
        enabled: true,
        fileInfo,
        fileOrganizer: this.deps.fileOrganizer,
        plan,
      });
      const sourceStats = await stat(fileInfo.filePath);
      const stagedArtifactPaths = Array.from(
        new Set([...(downloadedAssets.downloaded ?? []), ...prepared.actorPhotoPaths]),
      );
      const artifacts: PreparedPublicationPlan["artifacts"] = await Promise.all(
        stagedArtifactPaths.map(async (stagedPath) => ({
          targetPath: toTargetPath(stagedPath),
          content: { kind: "bytes" as const, data: await readFile(stagedPath) },
        })),
      );
      artifacts.push(
        ...[...nfoArtifacts].map(([targetPath, data]) => ({
          targetPath,
          content: { kind: "text" as const, data },
        })),
      );
      if (plan.strmPath) {
        artifacts.push({ targetPath: plan.strmPath, content: { kind: "text", data: outputVideoPath } });
      }
      const assetTargets: PreparedPublicationPlan["assets"] = [];
      const addLocalAsset = (kind: string, targetPath: string | undefined) => {
        if (targetPath) assetTargets.push({ kind, targetPath });
      };
      addLocalAsset("thumb", targetAssets.thumb);
      addLocalAsset("poster", targetAssets.poster);
      addLocalAsset("fanart", targetAssets.fanart);
      addLocalAsset("trailer", targetAssets.trailer);
      for (const sceneImage of targetAssets.sceneImages) addLocalAsset("scene", sceneImage);
      const addRemoteAsset = (kind: string, url: string | undefined) => {
        if (url?.trim()) assetTargets.push({ kind, url });
      };
      addRemoteAsset("thumb", crawlerData.thumb_source_url ?? crawlerData.thumb_url);
      addRemoteAsset("poster", crawlerData.poster_source_url ?? crawlerData.poster_url);
      addRemoteAsset("fanart", crawlerData.fanart_source_url ?? crawlerData.fanart_url);
      addRemoteAsset("trailer", crawlerData.trailer_source_url ?? crawlerData.trailer_url);
      for (const url of crawlerData.scene_images) addRemoteAsset("scene", url);
      this.setProgress(progress, 100);
      const classification = classifyMovie(fileInfo, crawlerData, existingNfoLocalState);
      const preparedPlan: PreparedPublicationPlan = {
        video: { sourcePath: fileInfo.filePath, targetPath: outputVideoPath, size: sourceStats.size },
        artifacts,
        assets: assetTargets,
        obsoletePaths: [],
      };
      const identity = toScrapeIdentity(fileId, fileInfo, options);
      const publicationPlan =
        options.roots && options.roots.length > 0
          ? createPublicationPlan(
              options.operationId ?? `${options.scrapeSessionId ?? "scrape"}:${identity.relativePath}`,
              "scrape",
              preparedPlan,
              options.roots,
            )
          : undefined;
      const toRef = (absolutePath: string) =>
        options.roots && options.roots.length > 0
          ? toRootFileRef(absolutePath, options.roots)
          : { rootId: identity.rootId, relativePath: absolutePath };
      const result: FileScrapeResult = {
        ...identity,
        status: "success",
        crawlerData,
        videoMeta,
        output: publicationPlan?.video?.target ?? toRef(outputVideoPath),
        ...(savedNfoPath ? { nfo: toRef(savedNfoPath) } : {}),
        assets: publicationPlan?.assets ?? [],
        sources: aggregationResult.sources,
        uncensoredAmbiguous:
          classification.uncensored &&
          !classification.umr &&
          !classification.leak &&
          !isLikelyUncensoredNumber(crawlerData.number || fileInfo.number),
        publicationPlan,
      };
      this.deps.signalService.showScrapeResult(result);
      return result;
    } catch (error) {
      this.setProgress(progress, 100);
      if (isAbortError(error)) {
        this.deps.logger.info(`Scrape aborted for ${fileInfo.filePath}`);
        const result: ScrapeResult = {
          ...toScrapeIdentity(fileId, fileInfo, options),
          status: "skipped",
          error: "Operation aborted",
        };
        this.deps.signalService.showScrapeResult(result);
        return result;
      }

      const message = toErrorMessage(error);
      this.deps.logger.error(`Scrape failed for ${fileInfo.filePath}: ${message}`);
      const result: ScrapeResult = { ...toScrapeIdentity(fileId, fileInfo, options), status: "failed", error: message };
      this.deps.signalService.showScrapeResult(result);
      this.deps.signalService.showFailedInfo({ fileInfo, error: message });
      return result;
    } finally {
      if (stagingDir) await rm(stagingDir, { recursive: true, force: true });
      release?.();
      if (this.numberExecutionChains.get(lockKey) === chain) this.numberExecutionChains.delete(lockKey);
    }
  }

  private async aggregate(
    fileInfo: FileInfo,
    configuration: Configuration,
    signal?: AbortSignal,
    manualScrape?: ManualScrapeOptions,
  ): Promise<AggregationResult | null> {
    if (isGeneratedSidecarVideo(fileInfo.filePath)) {
      return await this.deps.aggregationService.aggregate(fileInfo.number, configuration, signal, manualScrape);
    }

    const number = fileInfo.number.trim().toUpperCase();
    const key = manualScrape ? `${number}::${manualScrape.site}::${manualScrape.detailUrl ?? ""}` : number;
    const existing = this.aggregationPromises.get(key);
    if (existing) return await existing;

    const request = this.deps.aggregationService.aggregate(fileInfo.number, configuration, signal, manualScrape);
    this.aggregationPromises.set(key, request);
    try {
      return await request;
    } catch (error) {
      setTimeout(() => {
        if (this.aggregationPromises.get(key) === request) this.aggregationPromises.delete(key);
      }, AGGREGATION_FAILURE_CACHE_WINDOW_MS).unref?.();
      throw error;
    }
  }

  private setProgress(progress: FileScrapeProgress, percent: number): void {
    updateBatchProgress(this.deps.signalService, progress, percent);
  }

  private requireWebsite(crawlerData: CrawlerData): Website {
    if (!crawlerData.website) throw new Error("Scrape crawler website not initialized");
    return crawlerData.website;
  }
}
