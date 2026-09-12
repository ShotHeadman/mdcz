import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
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
import { runWithScrapeItem } from "../network/networkExecution";
import { createPublicationPlan, type PublicationPlan, preparePublicationPlan, toRootFileRef } from "../publication";
import type { RuntimeActorImageService, RuntimeActorSourceProvider } from "./actorOutput";
import type { AggregationResult, AggregationService, ManualScrapeOptions } from "./aggregation";
import { canonicalizeCrawlerDataActorAliases } from "./canonicalizeActorAliases";
import type { DownloadManager } from "./download";
import { type FileOrganizer, type OrganizePlan, resolveMetadataOutputDir } from "./FileOrganizer";
import { isGeneratedSidecarVideo, resolveFileInfoWithSubtitles } from "./media";
import { findExistingNfoPath, type NfoGenerator, type NfoOptions } from "./nfo";
import {
  downloadCrawlerAssets,
  prepareOutputCrawlerData,
  reportItemProgress,
  writePreparedNfo,
} from "./output/executeOutputSteps";
import type { TranslateService } from "./TranslateService";
import { isAbortError, throwIfAborted } from "./utils/abort";
import { pathExists } from "./utils/filesystem";
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
  outputDirectory?: string;
  outputTemplateRoot?: string;
};
export type FileScrapeResult = ScrapeResult &
  (
    | { status: "success"; publicationPlan: PublicationPlan }
    | { status: "failed" | "skipped"; publicationPlan?: never }
  ) & {
    release?: () => Promise<void>;
  };
type FileScrapeFailure = ScrapeResult & { status: "failed" | "skipped"; publicationPlan?: never };
type ScrapeIdentity = Pick<ScrapeResult, "fileId" | "rootId" | "relativePath" | "fileName" | "part" | "assets">;

export interface PreparedFileScrape {
  configuration: Configuration;
  fileInfo: FileInfo;
  sourcePath: string;
  identity: ScrapeIdentity;
  localState?: NfoLocalState;
  videoMeta?: VideoMeta;
  crawlerData: CrawlerData;
  translationError?: string;
  aggregation: AggregationResult;
  outputPlan: OrganizePlan;
  roots: readonly Pick<MediaRoot, "id" | "hostPath">[];
  operationId: string;
}

export type FilePreparationResult = { status: "prepared"; prepared: PreparedFileScrape } | FileScrapeFailure;

const toScrapeIdentity = (fileId: string, fileInfo: FileInfo, options: FileScrapeOptions): ScrapeIdentity => ({
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

  constructor(
    private readonly deps: FileScraperDependencies,
    private readonly options: CreateFileScraperOptions = {},
  ) {}

  async prepareFile(
    filePath: string,
    progress: FileScrapeProgress = { fileIndex: 1, totalFiles: 1 },
    signal?: AbortSignal,
    options: FileScrapeOptions = {},
  ): Promise<FilePreparationResult> {
    const roots = options.roots;
    if (!roots?.length) throw new Error("Scrape publication requires registered media roots");
    const configuration = structuredClone(await this.deps.getConfiguration());
    const parsedFileInfo = parseFileInfo(filePath, configuration.scrape.filenameIgnoreTokens);
    const fileId = buildFileId(parsedFileInfo.filePath);
    let fileInfo = parsedFileInfo;
    const identity = () => toScrapeIdentity(fileId, fileInfo, options);
    this.deps.signalService.showScrapeResult({ ...identity(), status: "processing" });
    this.setProgress(progress, 0);

    try {
      const resolved = await resolveFileInfoWithSubtitles(filePath, { parsedFileInfo });
      fileInfo = resolved.fileInfo;
      const videoMeta = await this.deps.probeVideoMetadata?.(fileInfo.filePath);
      const localState = await this.deps.loadExistingNfoLocalState?.(fileInfo.filePath, configuration);
      const scrapeSessionId = options.scrapeSessionId ?? this.options.scrapeSessionId;
      this.deps.signalService.showLogText(
        `Preparing file scrape task ${randomUUID()} for ${fileInfo.fileName} (scrapeSessionId: ${scrapeSessionId ?? "standalone"})`,
      );
      throwIfAborted(signal);
      this.deps.signalService.showScrapeInfo({ fileInfo, site: configuration.scrape.sites[0], step: "search" });
      const aggregation = await this.aggregate(fileInfo, configuration, signal, options.manualScrape);
      throwIfAborted(signal);
      if (!aggregation) {
        const error =
          this.deps.aggregationService.getFailureSummary?.(fileInfo.number) ?? "No crawler returned metadata";
        return this.failed(identity(), fileInfo, error);
      }

      const translation = await this.deps.translateService.translateCrawlerData(
        aggregation.data,
        configuration,
        signal,
      );
      let crawlerData = translation.data;
      const translationError = translation.error;
      throwIfAborted(signal);
      crawlerData = canonicalizeCrawlerDataActorAliases(crawlerData, configuration);
      const outputPlan = await this.deps.fileOrganizer.resolveOutputPlan(
        {
          ...this.deps.fileOrganizer.plan(fileInfo, crawlerData, configuration, localState, {
            executionMode: this.options.mode ?? "batch",
            outputDirectory: options.outputDirectory,
            outputTemplateRoot: options.outputTemplateRoot,
          }),
          subtitleSidecars: resolved.subtitleSidecars,
        },
        fileInfo.filePath,
        {
          allowSharedDirectory:
            configuration.naming.assetNamingMode === "followVideo" && configuration.download.nfoNaming === "filename",
        },
      );
      throwIfAborted(signal);
      this.setProgress(progress, 50);
      return {
        status: "prepared",
        prepared: {
          configuration,
          fileInfo,
          sourcePath: fileInfo.filePath,
          identity: identity(),
          localState,
          videoMeta,
          crawlerData,
          translationError: translationError ? `Translation failed: ${translationError}` : undefined,
          aggregation,
          outputPlan,
          roots,
          operationId: options.operationId ?? `${scrapeSessionId ?? "scrape"}:${identity().relativePath}`,
        },
      };
    } catch (error) {
      if (isAbortError(error)) {
        this.deps.logger.info(`Scrape preparation aborted for ${fileInfo.filePath}`);
        return this.skipped(identity(), "Operation aborted");
      }
      return this.failed(identity(), fileInfo, toErrorMessage(error));
    }
  }

  async executePreparedFiles(
    entries: readonly { prepared: PreparedFileScrape; progress: FileScrapeProgress; caseId?: string }[],
    signal?: AbortSignal,
  ): Promise<FileScrapeResult[]> {
    if (!entries.length) return [];
    const failures = new Map<string, FileScrapeResult>();
    const ready: (typeof entries)[number][] = [];
    for (const entry of entries) {
      try {
        const file = await stat(entry.prepared.sourcePath);
        if (!file.isFile()) throw new Error("Scrape source is not a file");
        ready.push(entry);
      } catch (error) {
        failures.set(
          entry.prepared.sourcePath,
          this.failed(entry.prepared.identity, entry.prepared.fileInfo, toErrorMessage(error)),
        );
      }
    }
    const first = ready[0];
    if (!first) return entries.map(({ prepared }) => failures.get(prepared.sourcePath) as FileScrapeResult);
    const { prepared, progress } = first;
    const { configuration, fileInfo, identity, aggregation, outputPlan: plan } = prepared;
    const roots = [...new Map(ready.flatMap(({ prepared }) => prepared.roots).map((root) => [root.id, root])).values()];
    return await runWithScrapeItem(
      { itemId: identity.fileId, relativePath: identity.relativePath, caseId: first.caseId },
      async () => {
        let stagingDir: string | undefined;
        let stagingHandedOff = false;

        try {
          throwIfAborted(signal);
          stagingDir = await mkdtemp(path.join(tmpdir(), "mdcz-publication-"));
          const metadataOutputDir = resolveMetadataOutputDir(plan);
          let crawlerData = prepared.crawlerData;
          let actorPhotoPaths: string[] = [];
          let downloadedAssets: DownloadedAssets = { downloaded: [], sceneImages: [] };
          const actorOutput = await prepareOutputCrawlerData({
            actorImageService: this.deps.actorImageService,
            actorSourceProvider: this.deps.actorSourceProvider,
            config: configuration,
            crawlerData,
            enabled: true,
            movieDir: stagingDir,
            sourceVideoPath: prepared.sourcePath,
            signal,
          });
          crawlerData = actorOutput.data ?? crawlerData;
          actorPhotoPaths = actorOutput.actorPhotoPaths;
          throwIfAborted(signal);
          this.setProgress(progress, 60);
          this.deps.signalService.showScrapeInfo({
            fileInfo,
            site: this.requireWebsite(crawlerData),
            step: "download",
          });
          const downloaded = await downloadCrawlerAssets({
            config: configuration,
            crawlerData,
            downloadManager: this.deps.downloadManager,
            fileInfo,
            imageAlternatives: aggregation.imageAlternatives,
            movieBaseName: path.basename(plan.nfoPath, ".nfo"),
            outputDir: stagingDir,
            existingAssetDir: metadataOutputDir,
            sources: aggregation.sources,
            callbacks: { signal },
            onLog: (message) => this.deps.signalService.showLogText(message),
            postProcessAssets: this.deps.postProcessAssets
              ? async (assets, resolvedCrawlerData) =>
                  (await this.deps.postProcessAssets?.({
                    assets,
                    configuration,
                    crawlerData: resolvedCrawlerData,
                    fileInfo,
                    localState: prepared.localState,
                    signal,
                  })) ?? assets
              : undefined,
          });
          crawlerData = downloaded.crawlerData;
          downloadedAssets = downloaded.assets;
          throwIfAborted(signal);
          this.setProgress(progress, 80);
          const preservedNfoPath = configuration.download.keepNfo
            ? await findExistingNfoPath(plan.nfoPath, configuration.download.nfoNaming, pathExists)
            : undefined;
          const publication = await preparePublicationPlan({
            files: ready.map(({ prepared }) => ({
              sourceVideoPath: prepared.sourcePath,
              outputVideoPath: prepared.outputPlan.targetVideoPath,
              organizePlan: prepared.outputPlan,
            })),
            onFileError: (sourcePath, error) => {
              const entry = ready.find(({ prepared }) => prepared.sourcePath === sourcePath);
              if (!entry) throw new Error(`Unknown scrape source: ${sourcePath}`);
              failures.set(
                sourcePath,
                this.failed(entry.prepared.identity, entry.prepared.fileInfo, toErrorMessage(error)),
              );
            },
            stagingDir,
            existingAssetDir: metadataOutputDir,
            metadataOutputDir,
            downloadedAssets,
            actorPhotoPaths,
            existingNfoPath: preservedNfoPath,
            renameSubtitles: configuration.behavior.successFileRename,
            nfoNaming: configuration.download.nfoNaming,
            assetNamingMode: configuration.naming.assetNamingMode,
            strmPathMappings: configuration.paths.strmPathMappings,
            remoteData: crawlerData,
            writeNfo: async (assets, writeFile) =>
              await writePreparedNfo({
                assets,
                config: configuration,
                crawlerData,
                enabled: configuration.download.generateNfo && !preservedNfoPath,
                fileInfo,
                localState: prepared.localState,
                nfoGenerator: this.deps.nfoGenerator,
                buildTags: this.deps.buildTags,
                nfoPath: plan.nfoPath,
                sourceVideoPath: prepared.sourcePath,
                sources: aggregation.sources,
                videoMeta: prepared.videoMeta,
                probeVideoMetadata: this.deps.probeVideoMetadata,
                writeFile,
              }),
          });
          throwIfAborted(signal);
          const publicationPlan = createPublicationPlan(prepared.operationId, "scrape", publication.plan, roots);
          const toRef = (absolutePath: string) => toRootFileRef(absolutePath, roots);
          const results = entries.map(({ prepared, progress }): FileScrapeResult => {
            const failure = failures.get(prepared.sourcePath);
            if (failure) return failure;
            const { fileInfo, identity } = prepared;
            const target = toRef(prepared.outputPlan.targetVideoPath);
            const video = publicationPlan.media?.find(
              (media) => media.target.rootId === target.rootId && media.target.relativePath === target.relativePath,
            );
            if (!video) throw new Error("Scrape publication plan is missing its media file");
            const classification = classifyMovie(fileInfo, crawlerData, prepared.localState);
            const result: FileScrapeResult = {
              ...identity,
              status: "success",
              crawlerData,
              videoMeta: prepared.videoMeta,
              output: video.target,
              ...(publication.nfoPath ? { nfo: toRef(publication.nfoPath) } : {}),
              assets: video.assets ?? [],
              sources: aggregation.sources,
              uncensoredAmbiguous:
                classification.uncensored &&
                !classification.umr &&
                !classification.leak &&
                !isLikelyUncensoredNumber(crawlerData.number || fileInfo.number),
              ...(prepared.translationError ? { error: prepared.translationError } : {}),
              publicationPlan,
            };
            this.setProgress(progress, 100);
            this.deps.signalService.showScrapeResult(result);
            return result;
          });
          const successful = results.find((result) => result.status === "success");
          if (!successful) throw new Error("Scrape publication has no successful files");
          successful.release = async () => {
            await rm(stagingDir as string, { recursive: true, force: true });
          };
          stagingHandedOff = true;
          return results;
        } catch (error) {
          return entries.map(({ prepared, progress }) => {
            this.setProgress(progress, 100);
            return (
              failures.get(prepared.sourcePath) ??
              (isAbortError(error)
                ? this.skipped(prepared.identity, "Operation aborted")
                : this.failed(prepared.identity, prepared.fileInfo, toErrorMessage(error)))
            );
          });
        } finally {
          if (stagingDir && !stagingHandedOff) await rm(stagingDir, { recursive: true, force: true });
        }
      },
    );
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
    if (existing) return structuredClone(await existing);
    const request = this.deps.aggregationService.aggregate(fileInfo.number, configuration, signal, manualScrape);
    this.aggregationPromises.set(key, request);
    try {
      return structuredClone(await request);
    } catch (error) {
      setTimeout(() => {
        if (this.aggregationPromises.get(key) === request) this.aggregationPromises.delete(key);
      }, AGGREGATION_FAILURE_CACHE_WINDOW_MS).unref?.();
      throw error;
    }
  }

  private failed(
    identity: ScrapeIdentity,
    fileInfo: FileInfo,
    error: string,
  ): FileScrapeFailure & { status: "failed" } {
    this.deps.logger.error(`Scrape failed for ${fileInfo.filePath}: ${error}`);
    const result = { ...identity, status: "failed" as const, error };
    this.deps.signalService.showScrapeResult(result);
    this.deps.signalService.showFailedInfo({ fileInfo, error });
    return result;
  }

  private skipped(identity: ScrapeIdentity, error: string): FileScrapeFailure & { status: "skipped" } {
    const result = { ...identity, status: "skipped" as const, error };
    this.deps.signalService.showScrapeResult(result);
    return result;
  }

  private setProgress(progress: FileScrapeProgress, percent: number): void {
    reportItemProgress(this.deps.signalService, progress, percent);
  }

  private requireWebsite(crawlerData: CrawlerData): Website {
    if (!crawlerData.website) throw new Error("Scrape crawler website not initialized");
    return crawlerData.website;
  }
}
