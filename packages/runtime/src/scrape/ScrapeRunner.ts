import { basename, dirname, posix } from "node:path";
import { filesystemPathKey, type MediaRoot, resolveRootRelativePath } from "@mdcz/media-store";
import type {
  LibraryEntryRecord,
  LibraryRepository,
  ScrapeRunItemRecord,
  ScrapeRunManifest,
  ScrapeRunRecord,
  ScrapeRunRepository,
} from "@mdcz/persistence";
import { type Configuration, configurationSchema } from "@mdcz/shared/config";
import {
  type DirectorySource,
  type DirectoryTaskScope,
  type DiscoveryProgress,
  directoryTaskScopeSchema,
} from "@mdcz/shared/directoryTasks";
import { toErrorMessage } from "@mdcz/shared/error";
import { resolveManualScrapeRoute } from "@mdcz/shared/manualScrapeUrl";
import type { AssetRef, RootFileRef } from "@mdcz/shared/mediaRef";
import type {
  AmbiguousUncensoredItemDto,
  ScrapeConfirmUncensoredInput,
  ScrapeHistoryResponse,
  ScrapeHistoryRunDto,
  ScrapeLiveItemDto,
  ScrapeLiveRunsResponse,
  ScrapePendingUncensoredConfirmationItemDto,
  ScrapePendingUncensoredConfirmationResponse,
  ScrapeResultDetailResponse,
  ScrapeResultDto,
  ScrapeRunSnapshotDto,
  ScrapeStartInput,
  ScrapeTaskControlInput,
} from "@mdcz/shared/serverDtos";
import type {
  CrawlerData,
  DownloadedAssets,
  FileInfo,
  NfoLocalState,
  ScrapeResult,
  UncensoredConfirmResponse,
  VideoMeta,
} from "@mdcz/shared/types";
import { mediaPathOwnership } from "../library/mediaPathOwnership";
import type { ConfiguredMediaRootService } from "../library/mediaRootService";
import { registeredOutputPaths } from "../library/registeredMedia";
import type { NetworkClient } from "../network";
import { toCommittedMovie } from "../publication/committedMovie";
import { MoveOutput } from "../publication/MoveOutput";
import { movieOutputResultAssets } from "../publication/outputLibrary";
import { WriteOutput } from "../publication/WriteOutput";
import { type RuntimeLogger, runtimeLoggerService } from "../shared";
import {
  ScrapeCoordinator,
  type ScrapeHostExecution,
  type ScrapeHostPort,
  type ScrapeWorkflowReporter,
} from "../tasks/session/ScrapeCoordinator";
import type { ScrapeRunItem, ScrapeRunLogEntry, ScrapeRunSnapshot } from "../tasks/session/ScrapeRunSession";
import { toScrapeRunSnapshotDto } from "../tasks/session/scrapeRunSnapshotDto";
import type { ActorImageService } from "./ActorImageService";
import type { RuntimeActorSourceProvider } from "./actorOutput";
import { AggregationService } from "./aggregation";
import { confirmUncensoredRunItems } from "./confirmUncensored";
import { DirectoryInventory } from "./DirectoryInventory";
import { createDirectoryScope, discoverDirectoryFiles } from "./directoryDiscovery";
import { DownloadManager, type ImageHostCooldownStore } from "./download";
import { applyScrapeNetworkPolicy, createScrapeExecutionPolicy } from "./executionPolicy";
import { buildScrapePublicationKey, FileOrganizer } from "./FileOrganizer";
import { FileScraper, type PreparedFileScrape, type RuntimeScrapeSignalService } from "./FileScraper";
import { NfoGenerator } from "./nfo";
import { checkScrapeTargets } from "./preflightScrapeTask";
import { TranslateService } from "./TranslateService";
import type { TranslationMappingStore } from "./translate/types";
import { parseFileInfo } from "./utils/number";

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5000;

export class ScrapeRunnerError extends Error {
  constructor(
    public readonly code: "NO_FILES" | "INVALID_ARGUMENT",
    message: string,
  ) {
    super(message);
    this.name = "ScrapeRunnerError";
  }
}

export type ScrapeRunnerStartInput =
  | {
      mode: "directory";
      source: DirectorySource;
      targetDir?: string;
    }
  | {
      mode: "single";
      ref: RootFileRef;
      manualUrl?: string;
    }
  | {
      mode: "selection";
      refs: RootFileRef[];
      manualUrl?: string;
      outputRootId?: string;
      outputRelativeDirectory?: string;
    }
  | ScrapeStartInput;

type NormalizedScrapeStart =
  | {
      mode: "directory";
      scope: DirectoryTaskScope;
      rootId: string;
      outputRootId: string;
      outputRelativeDirectory: string;
    }
  | {
      mode: "single";
      ref: RootFileRef;
      manualUrl?: string;
      outputRootId?: string;
      outputRelativeDirectory?: string;
    }
  | {
      mode: "batch";
      refs: RootFileRef[];
      manualUrl?: string;
      outputRootId: string;
      outputRelativeDirectory: string;
    };

type ScrapeRunnerStartContext = {
  normalized: NormalizedScrapeStart;
  configuration: Configuration;
};

type RunnerManualScrape = ReturnType<typeof resolveManualScrapeRoute>;
type RunnerCoordinator = ScrapeCoordinator<
  ScrapeRunnerStartContext,
  ScrapeRunManifest,
  RunnerManualScrape,
  PreparedFileScrape
>;

export interface StartScrapeResult {
  taskId: string;
  totalFiles: number | null;
  snapshot: ScrapeRunSnapshotDto;
}

export interface ScrapeRunnerDependencies {
  persistence: {
    scrapeRuns: ScrapeRunRepository;
    library: LibraryRepository;
    publicationJournal: import("../publication/types").PublicationJournalPort;
    mediaRoots: ConfiguredMediaRootService;
    fileSystem?: import("../publication/types").PublicationFileSystem;
  };
  getConfiguration: () => Promise<Configuration>;
  networkClient: NetworkClient;
  crawlerProvider: import("../crawler").CrawlerProvider;
  imageHostCooldownStore: ImageHostCooldownStore;
  actorImageService: ActorImageService;
  actorSourceProvider?: RuntimeActorSourceProvider;
  mappingStore?: TranslationMappingStore;
  platform?: "desktop" | "server";
  logger?: {
    info(message: string): void;
    warn(message: string, error?: unknown): void;
    error(message: string, error?: unknown): void;
    debug?(message: string): void;
  };
  probeVideoMetadata?: (sourcePath: string) => Promise<VideoMeta | undefined>;
  postProcessAssets?: (input: {
    assets: DownloadedAssets;
    configuration: Configuration;
    crawlerData: CrawlerData;
    fileInfo: FileInfo;
    localState?: NfoLocalState;
    signal?: AbortSignal;
    signalService: Pick<RuntimeScrapeSignalService, "showLogText" | "setProgress">;
  }) => Promise<DownloadedAssets>;
  prepareScrapeItem?: <T extends { relativePath: string; caseId?: string }>(item: T) => T | Promise<T>;
  onCommitted?: (runId: string, result: ScrapeResult) => void;
  onInvalidate?: (runs: Array<{ run: ScrapeRunRecord; snapshot: ScrapeRunSnapshotDto }>) => void;
  onTerminal?: (run: ScrapeRunRecord, snapshot: ScrapeRunSnapshotDto) => Promise<void> | void;
  onError?: (runId: string, error: unknown) => Promise<void> | void;
  aggregationService?: Pick<AggregationService, "aggregate"> & {
    clearCache?: () => void;
    getFailureSummary?: (number: string) => string | undefined;
  };
}

const didPromiseTimeout = async (promise: Promise<unknown>, timeoutMs: number): Promise<boolean> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<boolean>((resolve) => {
    timeoutId = setTimeout(() => resolve(true), timeoutMs);
  });
  try {
    return await Promise.race([promise.then(() => false), timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
};

const toRootRelativePath = (root: MediaRoot, absolutePath: string): string => {
  const normalizedRoot = posix.normalize(root.hostPath.replace(/\\/g, "/"));
  const normalizedAbsolute = posix.normalize(absolutePath.replace(/\\/g, "/"));
  const relative = posix.relative(normalizedRoot, normalizedAbsolute);
  return relative === "" ? "" : relative;
};

export class ScrapeRunner {
  private readonly discoveredInventories = new Map<string, DirectoryInventory>();
  private readonly rootDisplayNames = new Map<string, string>();
  private readonly logger: RuntimeLogger;
  private readonly aggregationService: NonNullable<ScrapeRunnerDependencies["aggregationService"]>;
  private readonly translateService: TranslateService;
  private readonly nfoGenerator = new NfoGenerator();
  private readonly fileOrganizer = new FileOrganizer();
  private coordinatorInstance: RunnerCoordinator | null = null;
  private closed = false;
  private readonly terminalSnapshots = new Map<string, ScrapeRunSnapshotDto>();
  private lastTerminalSnapshot: ScrapeRunSnapshotDto | null = null;
  private readonly host: ScrapeHostPort<
    ScrapeRunnerStartContext,
    ScrapeRunManifest,
    RunnerManualScrape,
    PreparedFileScrape
  >;

  constructor(private readonly deps: ScrapeRunnerDependencies) {
    const rawLogger = deps.logger ?? runtimeLoggerService.getLogger("ScrapeRunner");
    this.logger = {
      debug: (msg: string) => rawLogger.debug?.(msg),
      info: (msg: string) => rawLogger.info(msg),
      warn: (msg: string, error?: unknown) => rawLogger.warn(msg, error),
      error: (msg: string, error?: unknown) => rawLogger.error(msg, error),
    };
    this.aggregationService =
      deps.aggregationService ?? new AggregationService(deps.crawlerProvider, { logger: this.logger });
    this.translateService = new TranslateService(deps.networkClient, {
      logger: this.logger,
      mappingStore: deps.mappingStore,
    });

    this.host = {
      create: async (input) => await this.createRun(input),
      runId: (run) => run.id,
      describe: (run) => ({
        executionGeneration: 0,
        totalItems: run.manifestFixedAt ? run.items.length : null,
      }),
      discover: async (run, signal, onProgress) => await this.discoverRun(run, signal, onProgress),
      createExecution: async (run, reporter) => await this.createExecution(run, reporter),
      onInvalidate: (runs) => {
        const dtoList = runs.map(({ run, snapshot, startedAt }) => ({
          run,
          snapshot: this.toSnapshotDto(run, snapshot, startedAt),
        }));
        this.deps.onInvalidate?.(dtoList);
      },
      onTerminal: async (run, snapshot) => {
        const dto = this.toSnapshotDto(run, snapshot, run.startedAt);
        this.terminalSnapshots.set(run.id, dto);
        this.lastTerminalSnapshot = dto;
        this.discoveredInventories.delete(run.id);
        this.aggregationService.clearCache?.();
        await this.deps.onTerminal?.(run, dto);
      },
      onError: async (runId, error) => {
        this.logger.error(`Scrape execution failed for ${runId}: ${toErrorMessage(error)}`);
        await this.deps.onError?.(runId, error);
      },
    };
  }

  async start(input: ScrapeRunnerStartInput): Promise<StartScrapeResult> {
    if (this.closed) throw new Error("Scrape queue is closing");
    const configuration = structuredClone(await this.deps.getConfiguration());
    applyScrapeNetworkPolicy(this.deps.networkClient, configuration);

    const normalized = await this.normalizeStartInput(input, configuration);
    const coordinator = await this.coordinator();
    const snapshot = await coordinator.start({ normalized, configuration });
    const initialSnapshot = await this.getSnapshot(snapshot.runId);
    if (!initialSnapshot) throw new Error(`Scrape task disappeared after start: ${snapshot.runId}`);

    return {
      taskId: snapshot.runId,
      totalFiles: snapshot.progress.totalItems,
      snapshot: initialSnapshot,
    };
  }

  async retry(runId: string, itemIds?: readonly string[]): Promise<StartScrapeResult> {
    if (!runId.trim()) throw new ScrapeRunnerError("NO_FILES", "No scrape run selected");
    if (this.closed) throw new Error("Scrape queue is closing");
    this.deps.imageHostCooldownStore.clear?.();
    const previousRun = await this.deps.persistence.scrapeRuns.get(runId);
    const root = await this.deps.persistence.mediaRoots.get(previousRun.rootId);
    this.rootDisplayNames.set(root.id, root.displayName);

    const coordinator = await this.coordinator();
    const snapshot = await coordinator.retry(runId, itemIds);
    const initialSnapshot = await this.getSnapshot(snapshot.runId);
    if (!initialSnapshot) throw new Error(`Scrape task disappeared after retry: ${snapshot.runId}`);

    return {
      taskId: snapshot.runId,
      snapshot: initialSnapshot,
      totalFiles:
        snapshot.progress.totalItems === null
          ? null
          : snapshot.items.filter((item) => item.status === "pending" || item.status === "processing").length,
    };
  }

  async rerunDirectory(runId: string): Promise<StartScrapeResult> {
    if (!runId.trim()) throw new ScrapeRunnerError("NO_FILES", "No scrape run selected");
    if (this.closed) throw new Error("Scrape queue is closing");
    this.deps.imageHostCooldownStore.clear?.();
    const previousRun = await this.deps.persistence.scrapeRuns.get(runId);
    const root = await this.deps.persistence.mediaRoots.get(previousRun.rootId);
    this.rootDisplayNames.set(root.id, root.displayName);

    const coordinator = await this.coordinator();
    const snapshot = await coordinator.rerunDirectory(runId);
    const initialSnapshot = await this.getSnapshot(snapshot.runId);
    if (!initialSnapshot) throw new Error(`Scrape task disappeared after rerun: ${snapshot.runId}`);

    return {
      taskId: snapshot.runId,
      snapshot: initialSnapshot,
      totalFiles: null,
    };
  }

  async stop(runId?: string): Promise<{ pendingCount: number; snapshot: ScrapeRunSnapshotDto }> {
    const live = this.coordinatorInstance?.liveRuns() ?? [];
    const target = runId ? live.find(({ run }) => run.id === runId) : live[0];
    if (!target) {
      const fallbackSnapshot = (runId ? this.terminalSnapshots.get(runId) : this.lastTerminalSnapshot) ?? {
        task: {
          id: runId ?? "none",
          kind: "scrape",
          rootId: "none",
          rootDisplayName: "none",
          revision: 0,
          executionGeneration: 0,
          status: "stopped",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          startedAt: null,
          completedAt: new Date().toISOString(),
          totalItems: 0,
          successCount: 0,
          failedCount: 0,
          skippedCount: 0,
          error: null,
          continuity: "final",
        },
        directorySource: null,
        discovery: null,
        progress: { percent: 0, completedItems: 0, totalItems: 0 },
        items: [],
        latestStage: null,
        logs: [],
        ambiguousUncensoredItems: [],
      };
      return { pendingCount: 0, snapshot: fallbackSnapshot };
    }

    const pendingCount = target.snapshot.items.filter(
      (item) => !["success", "failed", "skipped"].includes(item.status),
    ).length;
    const stoppedSnapshot = await this.coordinatorInstance?.stop(target.run.id);
    const dto = stoppedSnapshot
      ? this.toSnapshotDto(target.run, stoppedSnapshot, target.startedAt)
      : this.toSnapshotDto(target.run, target.snapshot, target.startedAt);
    return { pendingCount, snapshot: dto };
  }

  async pause(runId?: string): Promise<ScrapeRunSnapshotDto> {
    const live = this.coordinatorInstance?.liveRuns() ?? [];
    const target = runId ? live.find(({ run }) => run.id === runId) : live[0];
    if (!target) throw new Error("No live scrape task to pause");
    const snapshot = await this.coordinatorInstance?.pause(target.run.id);
    return this.toSnapshotDto(target.run, snapshot ?? target.snapshot, target.startedAt);
  }

  async resume(runId?: string): Promise<ScrapeRunSnapshotDto> {
    const live = this.coordinatorInstance?.liveRuns() ?? [];
    const target = runId ? live.find(({ run }) => run.id === runId) : live[0];
    if (!target) throw new Error("No live scrape task to resume");
    const snapshot = await this.coordinatorInstance?.resume(target.run.id);
    return this.toSnapshotDto(target.run, snapshot ?? target.snapshot, target.startedAt);
  }

  async waitForIdle(): Promise<void> {
    await this.coordinatorInstance?.waitForIdle();
  }

  async shutdown(options: { timeoutMs?: number } = {}): Promise<void> {
    const timeoutMs = Math.max(0, Math.trunc(options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS));
    this.logger.info("Shutting down scrape runner");
    this.closed = true;
    if (this.coordinatorInstance && (await didPromiseTimeout(this.coordinatorInstance.abortForShutdown(), timeoutMs))) {
      this.logger.warn(`Timed out waiting ${timeoutMs}ms for scrape runner shutdown`);
    }
    await (this.deps.imageHostCooldownStore as { flush?: () => Promise<void> }).flush?.();
  }

  async getSnapshot(taskId?: string): Promise<ScrapeRunSnapshotDto | null> {
    const runs = this.coordinatorInstance?.liveRuns() ?? [];
    const live = taskId ? runs.find(({ run }) => run.id === taskId) : runs[0];
    if (live) return this.toSnapshotDto(live.run, live.snapshot, live.startedAt);
    const cached = taskId ? this.terminalSnapshots.get(taskId) : this.lastTerminalSnapshot;
    if (cached) return cached;
    const manifest = taskId
      ? await this.deps.persistence.scrapeRuns.get(taskId)
      : await this.deps.persistence.scrapeRuns.getLatestFinalized();
    if (!manifest || (!taskId && !manifest.directoryScopeJson)) return null;
    const snapshot = await this.buildSnapshotFromManifest(manifest);
    this.terminalSnapshots.set(manifest.id, snapshot);
    this.lastTerminalSnapshot = snapshot;
    return snapshot;
  }

  async liveRuns(): Promise<ScrapeLiveRunsResponse> {
    const runs = this.coordinatorInstance?.liveRuns() ?? [];
    return {
      runs: runs.map(({ run, snapshot, startedAt }) => this.toSnapshotDto(run, snapshot, startedAt)),
    };
  }

  async history(input?: ScrapeTaskControlInput): Promise<ScrapeHistoryResponse> {
    const manifests = input?.taskId
      ? [await this.deps.persistence.scrapeRuns.get(input.taskId)]
      : await this.deps.persistence.scrapeRuns.list();

    const runs: ScrapeHistoryRunDto[] = [];
    const results: ScrapeResultDto[] = [];

    for (const manifest of manifests) {
      const summary = this.deps.persistence.scrapeRuns.summary(manifest);
      const root = await this.deps.persistence.mediaRoots.get(manifest.rootId).catch(() => null);
      runs.push({
        id: manifest.id,
        rootId: manifest.rootId,
        rootDisplayName: root?.displayName ?? manifest.rootId,
        requestedOutputRootId: manifest.requestedOutputRootId,
        outputRootId: summary?.outputRootId ?? null,
        executionMode: manifest.executionMode,
        disposition: (manifest.disposition ?? "interrupted") as ScrapeHistoryRunDto["disposition"],
        createdAt: manifest.createdAt.toISOString(),
        startedAt: manifest.startedAt?.toISOString() ?? null,
        completedAt: manifest.completedAt?.toISOString() ?? null,
        successCount: summary?.successCount ?? 0,
        failedCount: summary?.failedCount ?? 0,
        skippedCount: summary?.skippedCount ?? 0,
        totalBytes: summary?.totalBytes ?? 0,
        error: manifest.error,
      });

      results.push(
        ...(await Promise.all(
          manifest.items
            .filter((item) => item.status !== null)
            .map(async (item) => await this.itemToResultDto(manifest, item)),
        )),
      );
    }

    return { runs, results };
  }

  async pendingUncensoredConfirmation(): Promise<ScrapePendingUncensoredConfirmationResponse> {
    const manifests = await this.deps.persistence.scrapeRuns.list();
    const items: ScrapePendingUncensoredConfirmationItemDto[] = [];

    for (const manifest of manifests) {
      for (const item of manifest.items) {
        if (item.status === "success" && item.uncensoredAmbiguous) {
          let entry: LibraryEntryRecord | null = null;
          if (item.libraryFileId) {
            entry = await this.deps.persistence.library.getEntryByFileId(item.libraryFileId).catch(() => null);
          }
          const crawlerData = entry?.crawlerDataJson ? (JSON.parse(entry.crawlerDataJson) as CrawlerData) : undefined;
          const nfoAsset = entry?.assets.find((a) => a.kind === "nfo");

          items.push({
            id: item.id,
            ref: { rootId: item.rootId, relativePath: item.relativePath },
            fileId: item.id,
            fileName: posix.basename(item.relativePath),
            number: crawlerData?.number ?? posix.basename(item.relativePath, posix.extname(item.relativePath)),
            title: crawlerData?.title_zh ?? crawlerData?.title ?? null,
            nfoRelativePath: nfoAsset?.relativePath ?? null,
            taskId: manifest.id,
          });
        }
      }
    }

    return { items };
  }

  async result(id: string): Promise<ScrapeResultDetailResponse> {
    const item = await this.deps.persistence.scrapeRuns.getItem(id);
    const manifest = await this.deps.persistence.scrapeRuns.get(item.runId);
    return { result: await this.itemToResultDto(manifest, item) };
  }

  async confirmUncensored(input: ScrapeConfirmUncensoredInput): Promise<UncensoredConfirmResponse> {
    const configuration = await this.deps.getConfiguration();
    if (!configuration.download.generateNfo) {
      throw new ScrapeRunnerError("INVALID_ARGUMENT", "已关闭 NFO 生成功能，无法确认无码类型");
    }
    const manifest = await this.deps.persistence.scrapeRuns.get(input.taskId);
    const roots = await this.deps.persistence.mediaRoots.listRoots();

    const confirmation = await confirmUncensoredRunItems({
      manifest,
      items: input.items,
      configuration,
      roots,
      repositories: {
        library: this.deps.persistence.library,
        scrapeRuns: this.deps.persistence.scrapeRuns,
        journal: this.deps.persistence.publicationJournal,
      },
      dependencies: {
        fileOrganizer: this.fileOrganizer,
        localScanService: new (await import("../maintenance")).LocalScanService(),
        logger: this.logger,
        nfoGenerator: this.nfoGenerator,
        pathExists: async (path) => {
          try {
            await (await import("node:fs/promises")).stat(path);
            return true;
          } catch {
            return false;
          }
        },
      },
    });
    if (confirmation.failures.length > 0) {
      throw new Error(confirmation.failures.map((failure) => failure.message).join("\n"));
    }

    const refreshedManifest = await this.deps.persistence.scrapeRuns.get(manifest.id);
    const snapshot = await this.buildSnapshotFromManifest(refreshedManifest);
    this.terminalSnapshots.set(manifest.id, snapshot);
    this.lastTerminalSnapshot = snapshot;
    return {
      updatedCount: confirmation.updatedCount,
      items: confirmation.items,
    };
  }

  recordLog(
    runId: string,
    log: Omit<ScrapeRunLogEntry, "timestamp" | "itemId" | "relativePath"> & {
      timestamp?: Date;
      itemId?: string | null;
    },
  ): void {
    this.coordinatorInstance?.recordLog(runId, log);
  }

  private async coordinator() {
    if (this.closed) throw new Error("Scrape queue is closing");
    if (this.coordinatorInstance) return this.coordinatorInstance;
    this.coordinatorInstance = new ScrapeCoordinator(this.deps.persistence.scrapeRuns, this.host);
    return this.coordinatorInstance;
  }

  private async normalizeStartInput(
    input: ScrapeRunnerStartInput,
    configuration: Configuration,
  ): Promise<NormalizedScrapeStart> {
    if ("mode" in input) {
      if (input.mode === "directory") {
        const directoryScope = createDirectoryScope(
          input.source,
          input.targetDir ?? input.source.scanDir,
          configuration,
        );
        const root = await this.deps.persistence.mediaRoots.registerPathIntent(directoryScope.scanDir);
        const output = await this.deps.persistence.mediaRoots.registerPathIntent(directoryScope.targetDir);
        this.rootDisplayNames.set(root.id, root.displayName);
        return {
          mode: "directory",
          scope: directoryScope,
          rootId: root.id,
          outputRootId: output.id,
          outputRelativeDirectory: toRootRelativePath(output, directoryScope.targetDir),
        };
      }
      if (input.mode === "single") {
        return {
          mode: "single",
          ref: input.ref,
          manualUrl: input.manualUrl,
        };
      }
      if (input.refs.length === 0) throw new ScrapeRunnerError("NO_FILES", "No files selected");
      return {
        mode: "batch",
        refs: input.refs,
        manualUrl: input.manualUrl,
        outputRootId: input.outputRootId ?? input.refs[0].rootId,
        outputRelativeDirectory: input.outputRelativeDirectory ?? "",
      };
    }

    if ("executionMode" in input) {
      if ("source" in input) {
        const directoryScope = createDirectoryScope(input.source, input.targetDir, configuration);
        const root = await this.deps.persistence.mediaRoots.registerPathIntent(directoryScope.scanDir);
        const output = await this.deps.persistence.mediaRoots.registerPathIntent(directoryScope.targetDir);
        this.rootDisplayNames.set(root.id, root.displayName);
        return {
          mode: "directory",
          scope: directoryScope,
          rootId: root.id,
          outputRootId: output.id,
          outputRelativeDirectory: toRootRelativePath(output, directoryScope.targetDir),
        };
      }
      if (input.executionMode === "single") {
        const ref = input.refs[0];
        if (!ref) throw new ScrapeRunnerError("NO_FILES", "No files selected");
        return {
          mode: "single",
          ref,
          manualUrl: input.manualUrl,
          outputRootId: input.outputRootId,
          outputRelativeDirectory: input.outputRelativeDirectory,
        };
      }
      return {
        mode: "batch",
        refs: input.refs,
        manualUrl: input.manualUrl,
        outputRootId: input.outputRootId,
        outputRelativeDirectory: input.outputRelativeDirectory ?? "",
      };
    }

    throw new ScrapeRunnerError("INVALID_ARGUMENT", "Unknown scrape start input shape");
  }

  private async createRun(input: ScrapeRunnerStartContext): Promise<ScrapeRunManifest> {
    const { normalized, configuration } = input;

    if (normalized.mode === "directory") {
      return await this.deps.persistence.scrapeRuns.create({
        rootId: normalized.rootId,
        outputRootId: normalized.outputRootId,
        outputRelativeDirectory: normalized.outputRelativeDirectory || null,
        executionMode: "batch",
        configurationJson: JSON.stringify(configuration),
        directoryScopeJson: JSON.stringify(normalized.scope),
        items: [],
      });
    }

    const rawRefs = normalized.mode === "single" ? [normalized.ref] : normalized.refs;
    const canonicalRefs = await this.deps.persistence.mediaRoots.canonicalizeFileRefs(rawRefs);
    const inventory = new DirectoryInventory();
    const refs = await inventory.admitRefs(canonicalRefs, (id) => this.deps.persistence.mediaRoots.get(id));

    const rootId = refs[0]?.rootId;
    if (!rootId) throw new ScrapeRunnerError("NO_FILES", "No files selected");
    const root = await this.deps.persistence.mediaRoots.get(rootId);
    this.rootDisplayNames.set(root.id, root.displayName);

    const outputRootId =
      normalized.mode === "single" ? (normalized.outputRootId ?? refs[0].rootId) : normalized.outputRootId;
    const outputRelativeDirectory = normalized.outputRelativeDirectory || null;

    const manifest = await this.deps.persistence.scrapeRuns.create({
      rootId,
      outputRootId,
      outputRelativeDirectory,
      executionMode: normalized.mode,
      configurationJson: JSON.stringify(configuration),
      items: refs.map((ref, ordinal) => ({
        ordinal,
        rootId: ref.rootId,
        relativePath: ref.relativePath,
        manualUrl: normalized.manualUrl ?? null,
      })),
    });

    this.discoveredInventories.set(manifest.id, inventory);
    return manifest;
  }

  private async discoverRun(
    run: ScrapeRunManifest,
    signal: AbortSignal,
    onProgress: (progress: DiscoveryProgress) => void,
  ): Promise<ScrapeRunManifest> {
    if (!run.directoryScopeJson || !run.configurationJson) {
      throw new Error("Directory run is missing its scope or configuration");
    }

    const repository = this.deps.persistence;
    const generatedStrms = await registeredOutputPaths(
      repository.library,
      (id) => repository.mediaRoots.get(id),
      "strm",
    );
    const found = await discoverDirectoryFiles({
      scope: directoryTaskScopeSchema.parse(JSON.parse(run.directoryScopeJson)),
      configuration: configurationSchema.parse(JSON.parse(run.configurationJson)),
      mediaRoots: repository.mediaRoots,
      generatedStrms,
      signal,
      onProgress,
      platform: this.deps.platform ?? "desktop",
    });

    const manifest = await repository.scrapeRuns.fixManifest({
      runId: run.id,
      signal,
      discoveryJson: JSON.stringify(found.discovery),
      items: found.refs.map((ref, ordinal) => ({ ...ref, ordinal })),
    });

    this.discoveredInventories.set(run.id, found.inventory);
    return manifest;
  }

  private async createExecution(
    manifest: ScrapeRunManifest,
    reporter: ScrapeWorkflowReporter,
  ): Promise<ScrapeHostExecution<RunnerManualScrape, PreparedFileScrape>> {
    const outputRootIds = manifest.requestedOutputRootId ? [manifest.requestedOutputRootId] : [];
    const checkRoots = this.deps.persistence.mediaRoots.rootIntegrityGuard();
    await checkRoots([...new Set([...manifest.items.map((item) => item.rootId), ...outputRootIds])]);

    const configuration = configurationSchema.parse(JSON.parse(manifest.configurationJson ?? "null"));
    applyScrapeNetworkPolicy(this.deps.networkClient, configuration);
    const policy = createScrapeExecutionPolicy(configuration, { logger: this.logger });

    const roots = new Map<string, MediaRoot>();
    for (const item of manifest.items) {
      if (!roots.has(item.rootId)) {
        roots.set(item.rootId, await this.deps.persistence.mediaRoots.get(item.rootId));
      }
    }
    if (!manifest.requestedOutputRootId) throw new Error(`Scrape run has no output root: ${manifest.id}`);
    const outputRoot = await this.deps.persistence.mediaRoots.get(manifest.requestedOutputRootId);
    roots.set(outputRoot.id, outputRoot);

    const metadataPath = configuration.behavior.metadataOnly ? configuration.paths.metadataPath.trim() : "";
    if (metadataPath) {
      const metadataRoot = await this.deps.persistence.mediaRoots.ensurePathRecord({ hostPath: metadataPath });
      await checkRoots([metadataRoot.id]);
      roots.set(metadataRoot.id, metadataRoot);
    }

    const inventory = this.discoveredInventories.get(manifest.id) ?? new DirectoryInventory();
    this.discoveredInventories.delete(manifest.id);

    const fileScraper = new FileScraper(
      {
        outputs: this.deps.persistence.library,
        aggregationService: this.aggregationService,
        translateService: this.translateService,
        nfoGenerator: this.nfoGenerator,
        downloadManager: new DownloadManager(this.deps.networkClient, {
          imageHostCooldownStore: this.deps.imageHostCooldownStore,
          logger: this.logger,
        }),
        fileOrganizer: this.fileOrganizer,
        signalService: {
          setProgress: (value, current) => reporter.progress(manifest.items[current - 1]?.id ?? "", value),
          showLogText: () => undefined,
          showScrapeInfo: () => undefined,
          showFailedInfo: () => undefined,
        },
        actorImageService: this.deps.actorImageService,
        actorSourceProvider: this.deps.actorSourceProvider,
        getConfiguration: async () => configuration,
        logger: this.logger,
        postProcessAssets: this.deps.postProcessAssets,
        probeVideoMetadata: this.deps.probeVideoMetadata,
      },
      {
        mode: manifest.executionMode,
        scrapeSessionId: manifest.id,
        inventory,
      },
    );

    const manifestItemsById = new Map(manifest.items.map((item) => [item.id, item]));
    const items: ScrapeRunItem<RunnerManualScrape>[] = await Promise.all(
      manifest.items.map(async (item) => {
        const root = roots.get(item.rootId) ?? (await this.deps.persistence.mediaRoots.get(item.rootId));
        roots.set(item.rootId, root);
        const sourcePath = resolveRootRelativePath(root, item.relativePath);
        const enriched = (await this.deps.prepareScrapeItem?.({ ...item, sourcePath })) ?? { ...item, sourcePath };
        return {
          ...item,
          ...enriched,
          sourcePath,
          manualScrape: resolveManualScrapeRoute(item.manualUrl),
        };
      }),
    );

    const ownershipEntries = this.deps.persistence.library.inventoryOwnership();
    const locations = await Promise.all(
      ownershipEntries.map(async (entry) => {
        const root = roots.get(entry.rootId) ?? (await this.deps.persistence.mediaRoots.get(entry.rootId));
        roots.set(entry.rootId, root);
        return {
          ...entry,
          path: await inventory.entryPath(resolveRootRelativePath(root, entry.relativePath)),
        };
      }),
    );

    const owners = new Map<string, string>();
    for (const file of locations) {
      const identity = filesystemPathKey(file.path);
      if (file.kind === "strm") {
        inventory.generatedStrms.add(identity);
        continue;
      }
      if (file.kind !== "video") continue;
      const previous = owners.get(identity);
      if (previous && previous !== file.movieId)
        throw new Error(`Media entry belongs to multiple movies: ${file.path}`);
      owners.set(identity, file.movieId);
      inventory.registeredNfos.set(
        identity,
        locations
          .filter(
            (asset) =>
              asset.kind === "nfo" &&
              asset.movieId === file.movieId &&
              (asset.fileId === null || asset.fileId === file.fileId),
          )
          .map((asset) => asset.path),
      );
    }

    const movieGroups = new Map<string, { itemIds: string[]; movieId?: string; error?: string }>();
    const movieIdsByItemId = new Map<string, string | undefined>();
    const observed = new Map<string, { number: string; part?: number }[]>();
    for (const item of items) {
      const entryPath = await inventory.entryPath(item.sourcePath);
      const entryIdentity = filesystemPathKey(entryPath);
      const movieId = owners.get(entryIdentity);
      const fileInfo = parseFileInfo(item.sourcePath, configuration.scrape.filenameIgnoreTokens);
      const key =
        movieId ?? `${filesystemPathKey(dirname(entryPath))}\0${fileInfo.number.trim().toUpperCase() || entryIdentity}`;
      const group = movieGroups.get(key) ?? { itemIds: [], movieId };
      group.itemIds.push(item.id);
      movieIdsByItemId.set(item.id, movieId);
      const members = observed.get(key) ?? [];
      members.push({ number: fileInfo.number, part: fileInfo.part?.number });
      observed.set(key, members);
      if (!movieId) {
        const parts = members.flatMap((member) => (member.part === undefined ? [] : [member.part]));
        if (parts.length && parts.length !== members.length) {
          group.error = "同一影片同时包含分盘文件和独立文件，需要手动核对";
        }
        if (new Set(parts).size !== parts.length) {
          group.error = "同一影片存在重复分盘号，需要手动核对";
        }
      }
      const primary = await inventory.mediaEntries(dirname(item.sourcePath));
      if (
        fileInfo.extension.toLowerCase() === ".strm" &&
        !primary.some((entry) => entry.name === basename(item.sourcePath))
      ) {
        group.error = `不能单独刮削生成的媒体附属文件：${item.sourcePath}`;
      }
      movieGroups.set(key, group);
    }

    return {
      executionGeneration: 0,
      concurrency: manifest.executionMode === "single" ? 1 : policy.concurrency,
      items,
      initialItems: manifest.items.map((item) => ({
        id: item.id,
        status: (item.status ?? "pending") as Exclude<ScrapeRunItemRecord["status"], null | "processing">,
        error: item.errorMessage,
      })),
      movieGroups: [...movieGroups.values()],
      acquireItems: async (targetItems) =>
        mediaPathOwnership.acquireAll(
          targetItems.map((i) => filesystemPathKey(i.sourcePath)),
          targetItems
            .map((i) => i.id)
            .sort()
            .join(","),
        ),
      admitItem: async (item) => item.id,
      publicationKeys: (entries) => entries.map(({ prepared }) => buildScrapePublicationKey(prepared.outputPlan)),
      prepareGroup: async (entries, signal) => {
        await policy.restGate?.waitBeforeStart(signal);
        const results = await fileScraper.prepareGroup(
          entries.map(({ item }) => {
            const uncensoredChoice = manifestItemsById.get(item.id)?.uncensoredChoice;
            return {
              filePath: item.sourcePath,
              progress: {
                fileIndex: 1,
                totalFiles: manifest.items.length,
                onProgress: (percent) => reporter.progress(item.id, percent),
              },
              options: {
                configuration,
                roots: Array.from(roots.values()),
                source: { rootId: item.rootId, relativePath: item.relativePath },
                manualScrape: item.manualScrape,
                localState: uncensoredChoice ? { uncensoredChoice } : undefined,
                scrapeSessionId: manifest.id,
                itemId: item.id,
                attemptId: item.id,
                operationId: `${manifest.id}:${item.id}`,
                outputTemplateRoot: resolveRootRelativePath(
                  outputRoot,
                  manifest.requestedOutputRelativeDirectory ?? "",
                ),
                signalService: {
                  setProgress: (value) => reporter.progress(item.id, value),
                  showLogText: (message) => this.logger.info(message),
                  showScrapeInfo: ({ step, fileInfo }) =>
                    reporter.stage({ itemId: item.id, stage: step, message: fileInfo.fileName }),
                  showFailedInfo: ({ error }) => this.logger.warn(error),
                },
              },
            };
          }),
          signal,
        );
        const movieId = movieIdsByItemId.get(entries[0].item.id);
        for (const result of results) {
          if (result.status === "prepared") result.prepared.groupMovieId = movieId;
        }
        return results.map((result) => (result.status === "prepared" ? result : { status: result.status, result }));
      },
      checkTargets: async (entries) => {
        await checkScrapeTargets(
          entries.map(({ item, prepared }) => ({
            itemId: item.id,
            sourcePath: prepared.fileInfo.filePath,
            outputPlan: prepared.outputPlan,
          })),
          inventory,
        );
      },
      executePreparedItems: async (entries, signal) => {
        const ready = entries.map((e, index) => ({
          prepared: e.prepared,
          caseId: e.item.caseId,
          progress: {
            fileIndex: index + 1,
            totalFiles: entries.length,
            onProgress: (percent: number) => reporter.progress(e.item.id, percent),
          },
        }));
        const group = await fileScraper.executePreparedFiles(ready, signal);
        return {
          ...group,
          results: group.results.map((result, index) => ({
            itemId: entries[index]?.item.id ?? result.fileId,
            result,
          })),
        };
      },
      commitPreparationItem: async (item, result) => {
        const outcome = this.deps.persistence.scrapeRuns.commitOutcome({
          itemId: item.id,
          outcome: result.status === "skipped" ? "skipped" : "failed",
          error: result.status === "failed" ? result.error?.trim() || "刮削预检失败" : (result.error ?? null),
        });
        const finalResult = { ...result, resultId: outcome.id };
        this.deps.onCommitted?.(manifest.id, finalResult);
        return finalResult;
      },
      commitItems: async (entries, output) => {
        if (!output) {
          for (const entry of entries) {
            const res = entry.result;
            const status: "skipped" | "failed" = res?.status === "skipped" ? "skipped" : "failed";
            this.deps.persistence.scrapeRuns.commitOutcome({
              itemId: entry.item.id,
              outcome: status,
              error: res?.error ?? null,
            });
            if (res) this.deps.onCommitted?.(manifest.id, res);
          }
          return entries.map((entry) => {
            if (!entry.result) throw new Error(`Scrape item has no terminal result: ${entry.item.id}`);
            return { itemId: entry.item.id, result: entry.result };
          });
        }

        const committedMovie = toCommittedMovie(output);
        const completedAt = new Date();
        const committedFiles = new Map(committedMovie.files.map((file) => [file.fileId, file]));

        const commits = output.files.map((video) => {
          const facts = video.scrape;
          if (!facts) throw new Error("Scrape file has no prepared facts");
          const file = committedFiles.get(video.fileId);
          if (!file) throw new Error(`Committed movie omitted file: ${video.fileId}`);
          return {
            itemId: facts.itemId,
            error: facts.error ?? null,
            uncensoredAmbiguous: facts.uncensoredAmbiguous,
            completedAt,
            libraryEntry: {
              fileId: file.fileId,
              rootId: file.rootId,
              rootRelativePath: file.rootRelativePath,
              size: file.size,
              modifiedAt: file.modifiedAtMs === null ? null : new Date(file.modifiedAtMs),
              partNumber: file.partNumber,
              partSuffix: file.partSuffix,
              resolution: file.resolution,
              assets: committedMovie.assets.filter((asset) => asset.fileId === file.fileId),
              lastKnownPath: file.rootRelativePath,
            },
          };
        });

        const commit = () => {
          this.deps.persistence.scrapeRuns.commitSuccessOutcomes(commits, {
            id: committedMovie.id,
            assets: committedMovie.assets.filter((asset) => asset.fileId === null),
            mediaIdentity: committedMovie.mediaIdentity,
            number: committedMovie.number,
            title: committedMovie.title,
            actors: [...committedMovie.actors],
            crawlerDataJson: committedMovie.crawlerDataJson,
            createdAt: completedAt,
          });
        };

        if (output.moves.length > 0) {
          await new MoveOutput(this.deps.persistence.fileSystem).install({
            operationId: output.operationId,
            operationType: "scrape",
            moves: output.moves,
            artifacts: output.artifacts,
            journal: this.deps.persistence.publicationJournal,
            protectedSourceRoots: output.protectedSourceRoots,
            commit,
          });
        } else {
          await new WriteOutput(this.deps.persistence.fileSystem).install(output.artifacts, {
            protectedSourceRoots: output.protectedSourceRoots,
            commit,
          });
        }

        return entries.map((entry) => {
          const video = output.files.find((f) => f.scrape?.itemId === entry.item.id);
          if (!video) {
            if (!entry.result) throw new Error(`Scrape output omitted item: ${entry.item.id}`);
            return { itemId: entry.item.id, result: entry.result };
          }
          const facts = video.scrape;
          if (!facts) throw new Error(`Scrape output file has no prepared facts: ${video.fileId}`);
          const result: ScrapeResult = {
            ...facts.identity,
            fileId: facts.itemId,
            resultId: facts.itemId,
            status: "success",
            crawlerData: output.scrape?.crawlerData,
            sources: output.scrape?.sources,
            videoMeta: facts.videoMeta,
            nfo: output.scrape?.nfo,
            uncensoredAmbiguous: facts.uncensoredAmbiguous,
            output: video.target,
            assets: movieOutputResultAssets(output, video),
          };
          this.deps.onCommitted?.(manifest.id, result);
          return { itemId: entry.item.id, result };
        });
      },
    };
  }

  private toSnapshotDto(
    manifest: ScrapeRunManifest,
    snapshot: ScrapeRunSnapshot,
    startedAt: Date | null,
  ): ScrapeRunSnapshotDto {
    return toScrapeRunSnapshotDto({
      manifest,
      snapshot,
      startedAt,
      rootDisplayName: this.rootDisplayNames.get(manifest.rootId) ?? manifest.rootId,
      completedAt: manifest.completedAt,
    });
  }

  private async buildSnapshotFromManifest(manifest: ScrapeRunRecord): Promise<ScrapeRunSnapshotDto> {
    const root = await this.deps.persistence.mediaRoots.get(manifest.rootId).catch(() => null);
    if (root) this.rootDisplayNames.set(root.id, root.displayName);
    const summary = this.deps.persistence.scrapeRuns.summary(manifest);

    const items: ScrapeLiveItemDto[] = await Promise.all(
      manifest.items.map(async (item) => {
        let entry: LibraryEntryRecord | null = null;
        if (item.libraryFileId) {
          entry = await this.deps.persistence.library.getEntryByFileId(item.libraryFileId).catch(() => null);
        }
        const file = entry?.files.find((f) => f.id === item.libraryFileId);
        const nfoAsset = entry?.assets.find((a) => a.kind === "nfo");
        const assets: AssetRef[] = (entry?.assets ?? []).map((a) => {
          if (a.rootId && a.relativePath) {
            return { type: "local", kind: a.kind, file: { rootId: a.rootId, relativePath: a.relativePath } };
          }
          return { type: "remote", kind: a.kind, url: a.uri };
        });
        const crawlerData = entry?.crawlerDataJson ? (JSON.parse(entry.crawlerDataJson) as CrawlerData) : null;

        return {
          id: item.id,
          resultId: item.id,
          rootId: item.rootId,
          relativePath: item.relativePath,
          fileName: posix.basename(item.relativePath),
          status: item.status ?? "pending",
          error: item.errorMessage,
          crawlerData,
          nfoRootId: nfoAsset?.rootId ?? null,
          nfoRelativePath: nfoAsset?.relativePath ?? null,
          outputRootId: file?.rootId ?? null,
          outputRelativePath: file?.rootRelativePath ?? null,
          assets,
          manualUrl: item.manualUrl,
          uncensoredAmbiguous: item.uncensoredAmbiguous,
        };
      }),
    );

    const ambiguousUncensoredItems: AmbiguousUncensoredItemDto[] = items
      .filter((item) => item.status === "success" && item.uncensoredAmbiguous)
      .map((item) => ({
        id: item.id,
        ref: { rootId: item.rootId, relativePath: item.relativePath },
        fileId: item.id,
        fileName: item.fileName,
        number: item.crawlerData?.number ?? posix.basename(item.relativePath, posix.extname(item.relativePath)),
        title: item.crawlerData?.title_zh ?? item.crawlerData?.title ?? null,
        nfoRelativePath: item.nfoRelativePath,
      }));

    const completedItems = items.filter(
      (item) => item.status === "success" || item.status === "failed" || item.status === "skipped",
    ).length;

    return {
      task: {
        id: manifest.id,
        kind: "scrape",
        rootId: manifest.rootId,
        rootDisplayName: root?.displayName ?? manifest.rootId,
        revision: 0,
        executionGeneration: 0,
        status: manifest.disposition ?? "interrupted",
        createdAt: manifest.createdAt.toISOString(),
        updatedAt: (manifest.completedAt ?? manifest.createdAt).toISOString(),
        startedAt: manifest.startedAt?.toISOString() ?? null,
        completedAt: manifest.completedAt?.toISOString() ?? null,
        totalItems: manifest.items.length,
        successCount: summary?.successCount ?? 0,
        failedCount: summary?.failedCount ?? 0,
        skippedCount: summary?.skippedCount ?? 0,
        error: manifest.error,
        continuity: !manifest.disposition || manifest.disposition === "interrupted" ? "interrupted" : "final",
      },
      directorySource: manifest.directoryScopeJson
        ? directoryTaskScopeSchema.parse(JSON.parse(manifest.directoryScopeJson))
        : null,
      discovery: manifest.discoveryJson ? (JSON.parse(manifest.discoveryJson) as DiscoveryProgress) : null,
      progress: {
        completedItems,
        totalItems: manifest.items.length,
        percent: manifest.items.length === 0 ? 0 : Math.round((completedItems / manifest.items.length) * 100),
      },
      items,
      latestStage: null,
      logs: [],
      ambiguousUncensoredItems,
    };
  }

  private async itemToResultDto(manifest: ScrapeRunRecord, item: ScrapeRunItemRecord): Promise<ScrapeResultDto> {
    let entry: LibraryEntryRecord | null = null;
    if (item.libraryFileId) {
      entry = await this.deps.persistence.library.getEntryByFileId(item.libraryFileId).catch(() => null);
    }
    const file = entry?.files.find((f) => f.id === item.libraryFileId);
    const nfoAsset = entry?.assets.find((a) => a.kind === "nfo");
    const assets: AssetRef[] = (entry?.assets ?? []).map((a) => {
      if (a.rootId && a.relativePath) {
        return { type: "local", kind: a.kind, file: { rootId: a.rootId, relativePath: a.relativePath } };
      }
      return { type: "remote", kind: a.kind, url: a.uri };
    });
    const crawlerData = entry?.crawlerDataJson ? (JSON.parse(entry.crawlerDataJson) as CrawlerData) : undefined;
    const root = await this.deps.persistence.mediaRoots.get(item.rootId).catch(() => null);

    return {
      id: item.id,
      taskId: manifest.id,
      rootId: item.rootId,
      rootDisplayName: root?.displayName ?? item.rootId,
      outputRootId: file?.rootId ?? manifest.requestedOutputRootId ?? null,
      relativePath: item.relativePath,
      fileName: posix.basename(item.relativePath),
      status: item.status ?? "failed",
      error: item.errorMessage,
      crawlerData: crawlerData ?? null,
      nfoRootId: nfoAsset?.rootId ?? null,
      nfoRelativePath: nfoAsset?.relativePath ?? null,
      outputRelativePath: file?.rootRelativePath ?? null,
      assets,
      manualUrl: item.manualUrl,
      uncensoredAmbiguous: item.uncensoredAmbiguous,
      persistenceState: "terminal",
      createdAt: (item.completedAt ?? manifest.createdAt).toISOString(),
      updatedAt: (item.completedAt ?? manifest.createdAt).toISOString(),
    };
  }
}
