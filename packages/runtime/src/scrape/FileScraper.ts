import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import path from "node:path";
import { filesystemPathKey, type MediaRoot } from "@mdcz/media-store";
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
import { resolvePublicationAssetLayout } from "../publication/assetLayout";
import { toRootFileRef } from "../publication/outputRefs";
import {
  type PreparedMovieOutput,
  prepareMovieOutput,
  retainedRegisteredFeatures,
} from "../publication/prepareMovieOutput";
import type { PublicationOutputPort } from "../publication/types";
import type { RuntimeActorImageService, RuntimeActorSourceProvider } from "./actorOutput";
import type { AggregationResult, AggregationService, ManualScrapeOptions } from "./aggregation";
import { canonicalizeCrawlerDataActorAliases } from "./canonicalizeActorAliases";
import { DirectoryInventory } from "./DirectoryInventory";
import type { DownloadManager } from "./download";
import type { FileOrganizer, ResolvedPublicationLayout } from "./FileOrganizer";
import { resolveFileInfoWithSubtitles } from "./media";
import { findExistingNfoPath, getNfoWritePaths, type NfoGenerator, type NfoOptions } from "./nfo";
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
  setProgress(value: number, current: number, total: number): void;
}

export interface FileScraperDependencies {
  outputs?: PublicationOutputPort;
  actorImageService: RuntimeActorImageService;
  actorSourceProvider?: RuntimeActorSourceProvider;
  aggregationService: Pick<AggregationService, "aggregate"> & {
    getFailureSummary?(number: string): string | undefined;
  };
  downloadManager: DownloadManager;
  fileOrganizer: FileOrganizer;
  getConfiguration(): Promise<Configuration>;
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
    signalService: Pick<RuntimeScrapeSignalService, "showLogText" | "setProgress">;
  }): Promise<DownloadedAssets>;
  probeVideoMetadata?(sourcePath: string): Promise<VideoMeta | undefined>;
  signalService: RuntimeScrapeSignalService;
  translateService: Pick<TranslateService, "translateCrawlerData">;
}

export type ScrapeExecutionMode = "single" | "batch";
export interface FileScrapeProgress {
  fileIndex: number;
  totalFiles: number;
  onProgress?: (percent: number) => void;
}
export type FileScrapeOptions = {
  configuration?: Configuration;
  localState?: NfoLocalState;
  signalService?: RuntimeScrapeSignalService;
  manualScrape?: ManualScrapeOptions;
  scrapeSessionId?: string;
  source?: RootFileRef;
  roots?: readonly Pick<MediaRoot, "id" | "hostPath">[];
  attemptId?: string;
  operationId?: string;
  outputDirectory?: string;
  outputTemplateRoot?: string;
};
export interface ScrapeGroupResult {
  results: ScrapeResult[];
  output?: PreparedMovieOutput;
  release?: () => Promise<void>;
}
type FileScrapeFailure = ScrapeResult & { status: "failed" | "skipped" };
type ScrapeIdentity = Pick<ScrapeResult, "fileId" | "rootId" | "relativePath" | "fileName" | "part" | "assets">;

export interface PreparedFileScrape {
  inventory?: DirectoryInventory;
  signalService: RuntimeScrapeSignalService;
  groupMovieId?: string;
  configuration: Configuration;
  fileInfo: FileInfo;
  identity: ScrapeIdentity;
  localState?: NfoLocalState;
  videoMeta?: VideoMeta;
  crawlerData: CrawlerData;
  translationError?: string;
  aggregation: AggregationResult;
  outputPlan: ResolvedPublicationLayout;
  roots: readonly Pick<MediaRoot, "id" | "hostPath">[];
  attemptId: string;
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
  inventory?: DirectoryInventory;
}
export class FileScraper {
  constructor(
    private readonly deps: FileScraperDependencies,
    private readonly options: CreateFileScraperOptions = {},
  ) {}

  async prepareGroup(
    entries: readonly { filePath: string; progress?: FileScrapeProgress; options: FileScrapeOptions }[],
    signal?: AbortSignal,
  ): Promise<FilePreparationResult[]> {
    if (!entries.length) return [];
    const configuration = structuredClone(entries[0].options.configuration ?? (await this.deps.getConfiguration()));
    const inventory = this.options.inventory ?? new DirectoryInventory();
    const members = entries.map(({ filePath, options, progress }, index) => {
      const fileInfo = parseFileInfo(filePath, configuration.scrape.filenameIgnoreTokens);
      return {
        options,
        progress: progress ?? { fileIndex: index + 1, totalFiles: entries.length },
        fileInfo,
        identity: toScrapeIdentity(buildFileId(fileInfo.filePath), fileInfo, options),
        signalService: options.signalService ?? this.deps.signalService,
      };
    });
    try {
      throwIfAborted(signal);
      const inspected = [];
      for (const member of members) {
        const { options, progress, fileInfo: parsedFileInfo } = member;
        if (!options.roots?.length) throw new Error("Scrape publication requires registered media roots");
        this.setProgress(progress, 0);
        const facts = await inventory.stats(parsedFileInfo.filePath);
        if (!facts.isFile()) throw new Error("Scrape source is not a file");
        const resolved = await resolveFileInfoWithSubtitles(parsedFileInfo.filePath, { parsedFileInfo, inventory });
        member.fileInfo = resolved.fileInfo;
        member.identity = toScrapeIdentity(member.identity.fileId, resolved.fileInfo, options);
        let localState = options.localState;
        if (configuration.download.generateNfo && configuration.download.keepNfo) {
          const directory = path.dirname(parsedFileInfo.filePath);
          const entries = await inventory.entries(directory);
          const videos = await inventory.mediaEntries(directory);
          const singleMovie = videos.every(
            (entry) =>
              parseFileInfo(entry.name, configuration.scrape.filenameIgnoreTokens).number === parsedFileInfo.number,
          );
          const partless = parsedFileInfo.part
            ? parsedFileInfo.fileName.slice(0, -parsedFileInfo.part.suffix.length)
            : undefined;
          const candidates = [partless, parsedFileInfo.fileName, ...(singleMovie ? ["movie"] : [])];
          const nfos = entries.filter(
            (entry) => (entry.isFile() || entry.isSymbolicLink()) && path.extname(entry.name).toLowerCase() === ".nfo",
          );
          const selected =
            candidates
              .map((name) => nfos.find((entry) => path.parse(entry.name).name.toLowerCase() === name?.toLowerCase()))
              .find(Boolean) ?? (singleMovie && nfos.length === 1 ? nfos[0] : undefined);
          const registered =
            inventory.registeredNfos.get(filesystemPathKey(await inventory.entryPath(parsedFileInfo.filePath))) ?? [];
          const nfoPath =
            registered.find((value) =>
              candidates.some((name) => name?.toLowerCase() === path.parse(value).name.toLowerCase()),
            ) ??
            registered[0] ??
            (selected ? path.join(directory, selected.name) : undefined);
          const snapshot = nfoPath ? await inventory.loadNfo(nfoPath) : undefined;
          localState = snapshot?.localState || localState ? { ...snapshot?.localState, ...localState } : undefined;
        }
        inspected.push({
          ...member,
          roots: options.roots,
          subtitleSidecars: resolved.subtitleSidecars,
          localState,
          videoMeta: await this.deps.probeVideoMetadata?.(parsedFileInfo.filePath),
        });
      }
      const { fileInfo, options, signalService } = inspected[0];
      const scrapeSessionId = options.scrapeSessionId ?? this.options.scrapeSessionId;
      signalService.showLogText(
        `Preparing movie scrape task ${randomUUID()} for ${fileInfo.number} (scrapeSessionId: ${scrapeSessionId ?? "standalone"})`,
      );
      signalService.showScrapeInfo({ fileInfo, site: configuration.scrape.sites[0], step: "search" });
      const aggregation = await this.deps.aggregationService.aggregate(
        fileInfo.number,
        configuration,
        signal,
        options.manualScrape,
      );
      throwIfAborted(signal);
      if (!aggregation) {
        const error =
          this.deps.aggregationService.getFailureSummary?.(fileInfo.number) ?? "No crawler returned metadata";
        return members.map((member) => this.failed(member.identity, member.fileInfo, error));
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
      const prepared: FilePreparationResult[] = [];
      for (const {
        fileInfo,
        identity,
        options,
        progress,
        signalService,
        localState,
        videoMeta,
        subtitleSidecars,
        roots,
      } of inspected) {
        const outputPlan = await this.deps.fileOrganizer.resolveOutputPlan(
          this.deps.fileOrganizer.plan(fileInfo, crawlerData, configuration, localState, {
            executionMode: this.options.mode ?? "batch",
            outputDirectory: options.outputDirectory,
            outputTemplateRoot: options.outputTemplateRoot,
          }),
          fileInfo.filePath,
          {
            allowSharedDirectory:
              configuration.naming.assetNamingMode === "followVideo" && configuration.download.nfoNaming === "filename",
            existingMetadataDir: path.dirname(fileInfo.filePath),
            strmPathMappings: configuration.paths.strmPathMappings,
            subtitleSidecars,
            inventory,
          },
        );
        throwIfAborted(signal);
        this.setProgress(progress, 50);
        prepared.push({
          status: "prepared",
          prepared: {
            inventory,
            signalService,
            configuration,
            fileInfo,
            identity,
            localState,
            videoMeta,
            crawlerData,
            translationError: translationError ? `Translation failed: ${translationError}` : undefined,
            aggregation,
            outputPlan,
            roots,
            attemptId: options.attemptId ?? options.operationId ?? identity.fileId,
            operationId: options.operationId ?? `${scrapeSessionId ?? "scrape"}:${identity.relativePath}`,
          },
        });
      }
      return prepared;
    } catch (error) {
      return members.map((member) =>
        isAbortError(error)
          ? this.skipped(member.identity, "Operation aborted")
          : this.failed(member.identity, member.fileInfo, toErrorMessage(error)),
      );
    }
  }

  async executePreparedFiles(
    entries: readonly { prepared: PreparedFileScrape; progress: FileScrapeProgress; caseId?: string }[],
    signal?: AbortSignal,
  ): Promise<ScrapeGroupResult> {
    if (!entries.length) return { results: [] };
    const states = entries.map((entry) => ({ ...entry, result: undefined as ScrapeResult | undefined }));
    const ready: (typeof states)[number][] = [];
    for (const entry of states) {
      try {
        const file = await stat(entry.prepared.fileInfo.filePath);
        if (!file.isFile()) throw new Error("Scrape source is not a file");
        ready.push(entry);
      } catch (error) {
        entry.result = this.failed(entry.prepared.identity, entry.prepared.fileInfo, toErrorMessage(error));
      }
    }
    const first = ready[0];
    const failed = states.find((entry) => entry.result);
    if (failed)
      return {
        results: states.map(
          (entry) =>
            entry.result ??
            this.failed(
              entry.prepared.identity,
              entry.prepared.fileInfo,
              failed.result?.error ?? "Movie source validation failed",
            ),
        ),
      };
    if (!first) return { results: [] };
    const { prepared, progress } = first;
    const { configuration, fileInfo, identity, aggregation, outputPlan: plan } = prepared;
    const { signalService } = prepared;
    const { postProcessAssets } = this.deps;
    const roots = [...new Map(ready.flatMap(({ prepared }) => prepared.roots).map((root) => [root.id, root])).values()];
    return await runWithScrapeItem(
      { itemId: identity.fileId, relativePath: identity.relativePath, caseId: first.caseId },
      async () => {
        let stagingDir: string | undefined;

        try {
          throwIfAborted(signal);
          const toRef = (absolutePath: string) => toRootFileRef(absolutePath, roots);
          const members = await Promise.all(
            ready.map(async ({ prepared }) => {
              const { sourceVideoPath: _sourceVideoPath, ...layout } = prepared.outputPlan;
              return {
                source: toRef(prepared.fileInfo.filePath),
                layout,
                prepared,
                assetLayout: await resolvePublicationAssetLayout({
                  layout: prepared.outputPlan,
                  config: configuration,
                  crawlerData: prepared.crawlerData,
                  movieBaseName: path.basename(plan.nfoPath, ".nfo"),
                  inventory: prepared.inventory,
                }),
              };
            }),
          );
          const outputPaths = [
            ...members.flatMap(({ assetLayout }) => [...assetLayout.staged.values(), ...assetLayout.retained.values()]),
            ...ready.flatMap(({ prepared }) => {
              const layout = prepared.outputPlan;
              return [
                ...(path.resolve(layout.targetVideoPath) === path.resolve(layout.sourceVideoPath)
                  ? []
                  : [layout.targetVideoPath]),
                ...getNfoWritePaths(layout.nfoPath, configuration.download.nfoNaming).requiredPaths,
                ...(layout.mirror ? [layout.mirror.targetPath] : []),
                ...layout.sidecars.flatMap((sidecar) => [
                  ...(path.resolve(sidecar.targetPath) === path.resolve(sidecar.sourcePath)
                    ? []
                    : [sidecar.targetPath]),
                  ...(sidecar.mirrorPath ? [sidecar.mirrorPath] : []),
                ]),
              ];
            }),
          ];
          const ownershipSnapshot = this.deps.outputs?.publicationSnapshot({
            paths: [...ready.map(({ prepared }) => prepared.outputPlan.sourceVideoPath), ...outputPaths],
            includeOwners: true,
          }) ?? { files: [], assets: [] };
          const featureSnapshot = this.deps.outputs?.publicationSnapshot({ kind: "feature", includeOwners: true });
          const sourceMovieIds = new Set(ready.flatMap(({ prepared }) => prepared.groupMovieId ?? []));
          if (sourceMovieIds.size > 1) throw new Error("Scrape group contains files from different library movies");
          const participantFiles = [...ownershipSnapshot.files, ...(featureSnapshot?.files ?? [])].filter(
            (file, index, files) =>
              files.findIndex(
                (candidate) =>
                  candidate.itemId === file.itemId &&
                  candidate.fileId === file.fileId &&
                  candidate.rootId === file.rootId &&
                  candidate.relativePath === file.relativePath,
              ) === index,
          );
          const participantAssets = [...ownershipSnapshot.assets, ...(featureSnapshot?.assets ?? [])].filter(
            (asset, index, assets) =>
              assets.findIndex(
                (candidate) =>
                  candidate.itemId === asset.itemId &&
                  candidate.fileId === asset.fileId &&
                  candidate.kind === asset.kind &&
                  candidate.rootId === asset.rootId &&
                  candidate.relativePath === asset.relativePath,
              ) === index,
          );
          const sourceMatches = members.map((member) =>
            participantFiles.find(
              (file) => file.rootId === member.source.rootId && file.relativePath === member.source.relativePath,
            ),
          );
          for (const match of sourceMatches) if (match) sourceMovieIds.add(match.itemId);
          if (sourceMovieIds.size > 1) throw new Error("Scrape group contains files from different library movies");
          const movieId = [...sourceMovieIds][0] ?? randomUUID();
          const participants = {
            movieId,
            members: members.map((member, index) => ({
              ...member,
              fileId: sourceMatches[index]?.fileId ?? randomUUID(),
            })),
            expected: {
              files: participantFiles.filter((file) => file.itemId === movieId),
              assets: participantAssets.filter((asset) => asset.itemId === movieId && !asset.historical),
            },
          };
          await mkdir(plan.metadataDir, { recursive: true });
          const directory = await mkdtemp(path.join(plan.metadataDir, ".mdcz-staging-"));
          stagingDir = directory;
          const metadataOutputDir = plan.metadataDir;
          let crawlerData = prepared.crawlerData;
          const actorOutput = await prepareOutputCrawlerData({
            actorImageService: this.deps.actorImageService,
            actorSourceProvider: this.deps.actorSourceProvider,
            config: configuration,
            crawlerData,
            enabled: true,
            movieDir: stagingDir,
            sourceVideoPath: prepared.fileInfo.filePath,
            signal,
          });
          crawlerData = actorOutput.data ?? crawlerData;
          throwIfAborted(signal);
          this.setProgress(progress, 60);
          if (!crawlerData.website) throw new Error("Scrape crawler website not initialized");
          signalService.showScrapeInfo({
            fileInfo,
            site: crawlerData.website,
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
            onLog: (message) => signalService.showLogText(message),
            postProcessAssets: postProcessAssets
              ? (assets, resolvedCrawlerData) =>
                  postProcessAssets({
                    assets,
                    configuration,
                    crawlerData: resolvedCrawlerData,
                    fileInfo,
                    localState: prepared.localState,
                    signal,
                    signalService,
                  })
              : undefined,
          });
          crawlerData = downloaded.crawlerData;
          throwIfAborted(signal);
          this.setProgress(progress, 80);
          const preservedNfoPath = configuration.download.keepNfo
            ? await findExistingNfoPath(plan.nfoPath, configuration.download.nfoNaming, pathExists)
            : undefined;
          const publication = await prepareMovieOutput({
            operationId: prepared.operationId,
            operationType: "scrape",
            roots,
            identity: {
              ...participants,
              members: participants.members.map(({ prepared, ...member }) => {
                const classification = classifyMovie(prepared.fileInfo, crawlerData, prepared.localState);
                const { fileId: itemId, assets, ...identity } = prepared.identity;
                return {
                  ...member,
                  existingNfoPath: preservedNfoPath,
                  scrape: {
                    itemId,
                    attemptId: prepared.attemptId,
                    identity,
                    fileInfo: prepared.fileInfo,
                    videoMeta: prepared.videoMeta,
                    error: prepared.translationError,
                    uncensoredAmbiguous:
                      classification.uncensored &&
                      !classification.umr &&
                      !classification.leak &&
                      !isLikelyUncensoredNumber(crawlerData.number || prepared.fileInfo.number),
                  },
                };
              }),
            },
            retainedMovieAssets: retainedRegisteredFeatures(participants.members, participants.expected.assets),
            stagingDir,
            downloadedAssets: downloaded.assets,
            actorPhotoPaths: actorOutput.actorPhotoPaths,
            nfoNaming: configuration.download.nfoNaming,
            remoteData: crawlerData,
            scrape: { crawlerData, sources: aggregation.sources },
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
                sourceVideoPath: prepared.fileInfo.filePath,
                sources: aggregation.sources,
                videoMeta: prepared.videoMeta,
                probeVideoMetadata: this.deps.probeVideoMetadata,
                writeFile,
              }),
          });
          throwIfAborted(signal);
          for (const { progress, result } of states) if (!result) this.setProgress(progress, 95);
          return {
            results: states.flatMap((entry) => (entry.result ? [entry.result] : [])),
            output: publication.output,
            release: () => rm(directory, { recursive: true, force: true }),
          };
        } catch (error) {
          if (stagingDir) {
            try {
              await rm(stagingDir, { recursive: true, force: true });
            } catch (cleanupError) {
              throw new AggregateError([error, cleanupError], "Scrape preparation and staging cleanup failed");
            }
          }
          return {
            results: states.map(({ prepared, progress, result }) => {
              this.setProgress(progress, 100);
              return (
                result ??
                (isAbortError(error)
                  ? this.skipped(prepared.identity, "Operation aborted")
                  : this.failed(prepared.identity, prepared.fileInfo, toErrorMessage(error)))
              );
            }),
          };
        }
      },
    );
  }

  private failed(
    identity: ScrapeIdentity,
    fileInfo: FileInfo,
    error: string,
  ): FileScrapeFailure & { status: "failed" } {
    this.deps.logger.error(`Scrape failed for ${fileInfo.filePath}: ${error}`);
    const result = { ...identity, status: "failed" as const, error };
    this.deps.signalService.showFailedInfo({ fileInfo, error });
    return result;
  }

  private skipped(identity: ScrapeIdentity, error: string): FileScrapeFailure & { status: "skipped" } {
    return { ...identity, status: "skipped" as const, error };
  }

  private setProgress(progress: FileScrapeProgress, percent: number): void {
    if (progress.onProgress) {
      progress.onProgress(percent);
      return;
    }
    reportItemProgress(this.deps.signalService, progress, percent);
  }
}
