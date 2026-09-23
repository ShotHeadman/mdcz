import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
import { type PublicationAssetLayout, resolvePublicationAssetLayout } from "../publication/assetLayout";
import {
  type PreparedMovieOutput,
  prepareMovieArtifacts,
  retainedRegisteredFeatures,
} from "../publication/movieArtifacts";
import { toRootFileRef } from "../publication/outputRefs";
import type { RuntimeActorImageService, RuntimeActorSourceProvider } from "./actorOutput";
import type { AggregationResult, AggregationService, ManualScrapeOptions } from "./aggregation";
import { DirectoryInventory } from "./DirectoryInventory";
import type { DownloadManager } from "./download";
import type { FileOrganizer, ResolvedPublicationLayout } from "./FileOrganizer";
import { resolveFileInfoWithSubtitles } from "./media";
import { getNfoReadCandidates, getNfoWritePaths, type NfoGenerator, type NfoOptions } from "./nfo";
import {
  downloadCrawlerAssets,
  prepareOutputCrawlerData,
  reportItemProgress,
  writePreparedNfo,
} from "./output/executeOutputSteps";
import { prepareOnlineMetadata } from "./prepareOnlineMetadata";
import { preferredLocalNfoBaseNames, selectLocalNfoName } from "./selectLocalNfo";
import type { TranslateService } from "./TranslateService";
import { isAbortError, throwIfAborted } from "./utils/abort";
import { classifyMovie, isLikelyUncensoredNumber } from "./utils/movieClassification";
import { parseFileInfo } from "./utils/number";

const entryNameMatches = (entryName: string, candidateName: string): boolean =>
  process.platform === "win32" ? entryName.toLowerCase() === candidateName.toLowerCase() : entryName === candidateName;

const findExistingNfoInInventory = async (
  inventory: DirectoryInventory,
  nfoPath: string,
  nfoNaming: Parameters<typeof getNfoReadCandidates>[1],
): Promise<string | undefined> => {
  for (const candidatePath of getNfoReadCandidates(nfoPath, nfoNaming)) {
    const entries = await inventory.entries(path.dirname(candidatePath));
    const name = path.basename(candidatePath);
    if (entries.some((entry) => (entry.isFile() || entry.isSymbolicLink()) && entryNameMatches(entry.name, name)))
      return candidatePath;
  }
  return undefined;
};

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
  actorImageService: RuntimeActorImageService;
  actorSourceProvider?: RuntimeActorSourceProvider;
  aggregationService: Pick<AggregationService, "aggregate">;
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
  itemId?: string;
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

export interface PreparedMovieMember {
  signalService: RuntimeScrapeSignalService;
  progress: FileScrapeProgress;
  fileInfo: FileInfo;
  identity: ScrapeIdentity;
  localState?: NfoLocalState;
  videoMeta?: VideoMeta;
  outputPlan: ResolvedPublicationLayout;
  assetLayout: PublicationAssetLayout;
  roots: readonly Pick<MediaRoot, "id" | "hostPath">[];
  itemId: string;
}

export interface PreparedMovieGroup {
  inventory: DirectoryInventory;
  movieId: string;
  assets: Array<RootFileRef & { fileId: string | null; kind: string; published: boolean }>;
  configuration: Configuration;
  crawlerData: CrawlerData;
  translationError?: string;
  aggregation: AggregationResult;
  artifactPaths: string[];
  members: PreparedMovieMember[];
}

export type FilePreparationResult = { status: "prepared"; prepared: PreparedMovieGroup } | FileScrapeFailure;

const toScrapeIdentity = (fileId: string, fileInfo: FileInfo, options: FileScrapeOptions): ScrapeIdentity => ({
  fileId,
  rootId: options.source?.rootId ?? "local",
  relativePath: options.source?.relativePath ?? fileInfo.filePath,
  fileName: fileInfo.fileName,
  assets: [],
  ...(fileInfo.part ? { part: fileInfo.part } : {}),
});

const plannedArtifactPaths = (configuration: Configuration, members: readonly PreparedMovieMember[]): string[] => {
  const videos = new Set(
    members.flatMap((member) => [
      path.resolve(member.fileInfo.filePath),
      path.resolve(member.outputPlan.targetVideoPath),
    ]),
  );
  const paths = new Set<string>();
  for (const member of members) {
    const { outputPlan: plan } = member;
    if (configuration.download.generateNfo)
      for (const nfo of getNfoWritePaths(plan.nfoPath, configuration.download.nfoNaming).requiredPaths)
        paths.add(path.resolve(nfo));
    for (const sidecar of plan.sidecars) paths.add(path.resolve(sidecar.targetPath));
    for (const target of [...member.assetLayout.staged.values(), ...member.assetLayout.retained.values()])
      paths.add(target);
  }
  return [...paths].filter((target) => !videos.has(target));
};

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
    entries: readonly {
      filePath: string;
      fileInfo?: FileInfo;
      groupMovieId?: string;
      groupFileId?: string;
      groupAssets?: Array<RootFileRef & { fileId: string | null; kind: string; published: boolean }>;
      progress?: FileScrapeProgress;
      options: FileScrapeOptions;
    }[],
    signal?: AbortSignal,
  ): Promise<FilePreparationResult> {
    if (!entries.length) {
      return {
        fileId: "",
        rootId: "local",
        relativePath: "",
        fileName: "",
        status: "skipped",
        error: "Movie group is empty",
        assets: [],
      };
    }
    const configuration = structuredClone(entries[0].options.configuration ?? (await this.deps.getConfiguration()));
    const inventory = this.options.inventory ?? new DirectoryInventory();
    const members = entries.map(
      ({ filePath, fileInfo: providedFileInfo, groupMovieId, groupFileId, groupAssets, options, progress }, index) => {
        const fileInfo = providedFileInfo ?? parseFileInfo(filePath, configuration.scrape.filenameIgnoreTokens);
        const fileId = groupFileId ?? buildFileId(fileInfo.filePath);
        return {
          options,
          groupMovieId,
          groupAssets,
          progress: progress ?? { fileIndex: index + 1, totalFiles: entries.length },
          fileInfo,
          identity: toScrapeIdentity(fileId, fileInfo, options),
          signalService: options.signalService ?? this.deps.signalService,
        };
      },
    );
    try {
      throwIfAborted(signal);
      const inspected = [];
      for (const member of members) {
        const { options, progress, fileInfo: parsedFileInfo } = member;
        if (!options.roots?.length) throw new Error("Scrape publication requires registered media roots");
        this.setProgress(progress, 0);
        const facts = await inventory.stats(parsedFileInfo.filePath).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT")
            throw new Error(`源文件未找到：${parsedFileInfo.filePath}（文件可能已移至目标路径，请在目标目录查看）`, {
              cause: error,
            });
          throw error;
        });
        if (!facts.isFile()) throw new Error("Scrape source is not a file");
        const resolved = await resolveFileInfoWithSubtitles(parsedFileInfo.filePath, { parsedFileInfo, inventory });
        member.fileInfo = resolved.fileInfo;
        member.identity = toScrapeIdentity(member.identity.fileId, resolved.fileInfo, options);
        let localState = options.localState;
        if (configuration.download.generateNfo && configuration.download.keepNfo) {
          const directory = path.dirname(parsedFileInfo.filePath);
          const listed = await inventory.entries(directory);
          const videos = await inventory.mediaEntries(directory);
          const singleMovie = videos.every(
            (entry) =>
              parseFileInfo(entry.name, configuration.scrape.filenameIgnoreTokens).number === parsedFileInfo.number,
          );
          const candidates = preferredLocalNfoBaseNames(
            parsedFileInfo.fileName,
            parsedFileInfo.part?.suffix,
            singleMovie,
          );
          const nfos = listed.filter(
            (entry) => (entry.isFile() || entry.isSymbolicLink()) && path.extname(entry.name).toLowerCase() === ".nfo",
          );
          const selectedName = selectLocalNfoName(
            nfos.map((entry) => entry.name),
            candidates,
            singleMovie,
          );
          const registered =
            inventory.registeredNfos.get(filesystemPathKey(await inventory.entryPath(parsedFileInfo.filePath))) ?? [];
          const nfoPath =
            registered.find((value) =>
              candidates.some((name) => name.toLowerCase() === path.parse(value).name.toLowerCase()),
            ) ??
            registered[0] ??
            (selectedName ? path.join(directory, selectedName) : undefined);
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
      const { aggregation, crawlerData, translationError } = await prepareOnlineMetadata({
        number: fileInfo.number,
        configuration,
        aggregationService: this.deps.aggregationService,
        translateService: this.deps.translateService,
        manualScrape: options.manualScrape,
        signal,
      });
      const preparedMembers: PreparedMovieMember[] = [];
      for (const member of inspected) {
        const outputPlan = await this.deps.fileOrganizer.resolveOutputPlan(
          this.deps.fileOrganizer.plan(member.fileInfo, crawlerData, configuration, member.localState, {
            executionMode: this.options.mode ?? "batch",
            outputDirectory: member.options.outputDirectory,
            outputTemplateRoot: member.options.outputTemplateRoot,
          }),
          member.fileInfo.filePath,
          {
            allowSharedDirectory:
              configuration.naming.assetNamingMode === "followVideo" && configuration.download.nfoNaming === "filename",
            existingMetadataDir: path.dirname(member.fileInfo.filePath),
            subtitleSidecars: member.subtitleSidecars,
            inventory,
          },
        );
        throwIfAborted(signal);
        this.setProgress(member.progress, 50);
        preparedMembers.push({
          signalService: member.signalService,
          progress: member.progress,
          fileInfo: member.fileInfo,
          identity: member.identity,
          localState: member.localState,
          videoMeta: member.videoMeta,
          outputPlan,
          assetLayout: await resolvePublicationAssetLayout({
            layout: outputPlan,
            config: configuration,
            crawlerData,
            movieBaseName: path.basename(preparedMembers[0]?.outputPlan.nfoPath ?? outputPlan.nfoPath, ".nfo"),
            inventory,
          }),
          roots: member.roots,
          itemId: member.options.itemId ?? member.options.operationId ?? member.identity.fileId,
        });
      }
      return {
        status: "prepared",
        prepared: {
          inventory,
          movieId: inspected[0].groupMovieId ?? randomUUID(),
          assets: inspected[0].groupAssets ?? [],
          configuration,
          crawlerData,
          translationError: translationError ? `Translation failed: ${translationError}` : undefined,
          aggregation,
          artifactPaths: plannedArtifactPaths(configuration, preparedMembers),
          members: preparedMembers,
        },
      };
    } catch (error) {
      return isAbortError(error)
        ? this.skipped(members[0].identity, "Operation aborted")
        : this.failed(members[0].identity, members[0].fileInfo, toErrorMessage(error));
    }
  }

  async executePreparedFiles(
    prepared: PreparedMovieGroup,
    signal?: AbortSignal,
    caseId?: string,
  ): Promise<ScrapeGroupResult> {
    if (!prepared.members.length) return { results: [] };
    const first = prepared.members[0];
    const { configuration, aggregation } = prepared;
    const plan = first.outputPlan;
    const { fileInfo, identity, signalService, progress } = first;
    const { postProcessAssets } = this.deps;
    const roots = [
      ...new Map(prepared.members.flatMap((member) => member.roots).map((root) => [root.id, root])).values(),
    ];
    return await runWithScrapeItem(
      { itemId: identity.fileId, relativePath: identity.relativePath, caseId },
      async () => {
        let stagingDir: string | undefined;

        try {
          throwIfAborted(signal);
          const toRef = (absolutePath: string) => toRootFileRef(absolutePath, roots);
          const members = await Promise.all(
            prepared.members.map(async (member) => {
              const { sourceVideoPath: _sourceVideoPath, ...layout } = member.outputPlan;
              return {
                source: toRef(member.fileInfo.filePath),
                layout,
                member,
                assetLayout: member.assetLayout,
              };
            }),
          );
          const participants = {
            movieId: prepared.movieId,
            members: members.map((member) => ({
              ...member,
              fileId: member.member.identity.fileId,
            })),
            assets: prepared.assets,
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
            sourceVideoPath: first.fileInfo.filePath,
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
            inventory: prepared.inventory,
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
                    localState: first.localState,
                    signal,
                    signalService,
                  })
              : undefined,
          });
          crawlerData = downloaded.crawlerData;
          throwIfAborted(signal);
          this.setProgress(progress, 80);
          const preservedNfoPath = configuration.download.keepNfo
            ? await findExistingNfoInInventory(prepared.inventory, plan.nfoPath, configuration.download.nfoNaming)
            : undefined;
          const publication = await prepareMovieArtifacts({
            inventory: prepared.inventory,
            roots,
            members: participants.members.map(({ member, ...rest }) => {
              const classification = classifyMovie(member.fileInfo, crawlerData, member.localState);
              const { assets: _assets, ...memberIdentity } = member.identity;
              return {
                ...rest,
                existingNfoPath: preservedNfoPath,
                scrape: {
                  itemId: member.itemId,
                  identity: memberIdentity,
                  fileInfo: member.fileInfo,
                  videoMeta: member.videoMeta,
                  error: prepared.translationError,
                  uncensoredAmbiguous:
                    classification.uncensored &&
                    !classification.umr &&
                    !classification.leak &&
                    !isLikelyUncensoredNumber(crawlerData.number || member.fileInfo.number),
                },
              };
            }),
            retainedMovieAssets: retainedRegisteredFeatures(participants.members, participants.assets),
            stagingDir,
            downloadedAssets: downloaded.assets,
            actorPhotoPaths: actorOutput.actorPhotoPaths,
            nfoNaming: configuration.download.nfoNaming,
            remoteData: crawlerData,
            writeNfo: async (assets, writeFile) =>
              await writePreparedNfo({
                assets,
                config: configuration,
                crawlerData,
                enabled: configuration.download.generateNfo && !preservedNfoPath,
                fileInfo,
                localState: first.localState,
                nfoGenerator: this.deps.nfoGenerator,
                buildTags: this.deps.buildTags,
                nfoPath: plan.nfoPath,
                sourceVideoPath: first.fileInfo.filePath,
                sources: aggregation.sources,
                videoMeta: first.videoMeta,
                probeVideoMetadata: this.deps.probeVideoMetadata,
                writeFile,
              }),
          });
          throwIfAborted(signal);
          for (const member of prepared.members) this.setProgress(member.progress, 95);
          return {
            results: [],
            output: {
              ...publication,
              movieId: participants.movieId,
              scrape: {
                crawlerData,
                sources: aggregation.sources,
                nfo: publication.nfoPath ? toRootFileRef(publication.nfoPath, roots) : undefined,
              },
            },
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
            results: prepared.members.map((member) => {
              this.setProgress(member.progress, 100);
              return isAbortError(error)
                ? this.skipped(member.identity, "Operation aborted")
                : this.failed(member.identity, member.fileInfo, toErrorMessage(error));
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
