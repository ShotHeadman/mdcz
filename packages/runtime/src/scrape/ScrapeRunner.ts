import { dirname, join } from "node:path";
import { filesystemPathKey, type MediaRoot, resolveRootRelativePath } from "@mdcz/media-store";
import type {
  LibraryRepository,
  MediaLibraryRecord,
  MediaLibraryRepository,
  PendingRepository,
  ScrapeRunManifest,
  ScrapeRunRecord,
  ScrapeRunRepository,
} from "@mdcz/persistence";
import type { Configuration } from "@mdcz/shared/config";
import { type DirectoryTaskScope, type DiscoveryProgress, directoryTaskScopeSchema } from "@mdcz/shared/directoryTasks";
import { toErrorMessage } from "@mdcz/shared/error";
import { resolveManualScrapeRoute } from "@mdcz/shared/manualScrapeUrl";
import type { PublicationTarget } from "@mdcz/shared/mediaLibrary";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type {
  ScrapeHistoryResponse,
  ScrapeHistoryRunDto,
  ScrapeLiveItemDto,
  ScrapeLiveRunsResponse,
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
  UncensoredChoice,
} from "@mdcz/shared/types";
import { toPublicationTarget } from "../library/mediaLibraryService";
import type { ConfiguredMediaRootService } from "../library/mediaRootService";
import { buildMovieTags } from "../maintenance/movieTags";
import type { NetworkClient } from "../network";
import { toCommittedMovie } from "../publication/committedMovie";
import { MoveOutput } from "../publication/MoveOutput";
import { movieOutputResultAssets } from "../publication/outputLibrary";
import { acquireOutputDirectories } from "../publication/outputMutex";
import { toRootFileRef } from "../publication/outputRefs";
import { WriteOutput } from "../publication/WriteOutput";
import { type RuntimeLogger, runtimeLoggerService } from "../shared";
import {
  ScrapeCoordinator,
  type ScrapeHostPort,
  type ScrapeWorkflowReporter,
} from "../tasks/session/ScrapeCoordinator";
import type {
  ScrapeRunExecution,
  ScrapeRunItem,
  ScrapeRunLogEntry,
  ScrapeRunSnapshot,
} from "../tasks/session/ScrapeRunSession";
import { toScrapeRunSnapshotDto } from "../tasks/session/scrapeRunSnapshotDto";
import type { ActorImageService } from "./ActorImageService";
import type { RuntimeActorSourceProvider } from "./actorOutput";
import { AggregationService, type CrawlerPort, type SiteResultSink } from "./aggregation";
import { DirectoryInventory } from "./DirectoryInventory";
import { createDirectoryScope, discoverDirectoryFiles } from "./directoryDiscovery";
import { DownloadManager, type ImageHostCooldownStore } from "./download";
import { applyScrapeNetworkPolicy, createScrapeExecutionPolicy } from "./executionPolicy";
import { assertTargetLayout, FileOrganizer } from "./FileOrganizer";
import { FileScraper, type PreparedMovieGroup, type RuntimeScrapeSignalService } from "./FileScraper";
import { admitScrapeGroups, type MovieGroup } from "./movieGroups";
import { NfoGenerator } from "./nfo";
import { versionKey } from "./organize/versionLabels";
import { checkScrapeTargets } from "./preflightScrapeTask";
import { TranslateService } from "./TranslateService";
import type { TranslationMappingStore } from "./translate/types";
import { expandScrapeRetryItems } from "./utils/number";
import { createVideoProbe } from "./utils/video";

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

type NormalizedScrapeStart = { library: MediaLibraryRecord } & (
  | {
      mode: "directory";
      scope: DirectoryTaskScope;
      rootId: string;
    }
  | {
      mode: "single" | "batch";
      refs: RootFileRef[];
      manualUrl?: string;
      number?: string;
      unpin?: boolean;
    }
);

type ScrapeRunnerStartContext = {
  normalized: NormalizedScrapeStart;
  configuration: Configuration;
};

type ScrapeRunContext = {
  // Frozen for one run so a batch never mixes behaviours; retries and reruns start new runs from current settings.
  // Connection settings (proxy, timeout, retries) stay live because NetworkClient reads them per request.
  configuration: Configuration;
  target: PublicationTarget;
  unpin?: boolean;
  inventory?: DirectoryInventory;
  groups?: MovieGroup[];
  rootGuard?: ReturnType<ConfiguredMediaRootService["rootIntegrityGuard"]>;
};
type RunnerManualScrape = ReturnType<typeof resolveManualScrapeRoute>;
export type PrepareScrapeItem = <T extends { fileInfo: Pick<FileInfo, "number">; caseId?: string }>(item: T) => T;
type RunnerScrapeItem = ScrapeRunItem & {
  fileId: string;
  entryIdentity: string;
  canonicalDirectory: string;
  fileInfo: FileInfo;
  manualScrape?: RunnerManualScrape;
  uncensoredChoice?: UncensoredChoice;
};
type RunnerCoordinator = ScrapeCoordinator<
  ScrapeRunnerStartContext,
  ScrapeRunManifest,
  RunnerScrapeItem,
  PreparedMovieGroup
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
    libraries: Pick<MediaLibraryRepository, "get">;
    pending: PendingRepository;
    mediaRoots: ConfiguredMediaRootService;
  };
  /** Directories that received published movies, for media servers to scan. */
  onPublished?: (directories: readonly string[], configuration: Configuration) => void;
  /** Files that newly entered the pending list. */
  onPending?: (count: number) => void;
  recordSiteResults: SiteResultSink;
  getConfiguration: () => Promise<Configuration>;
  networkClient: NetworkClient;
  crawlerProvider: CrawlerPort;
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
  mediaInfoWasmPath?: string;
  postProcessAssets?: (input: {
    assets: DownloadedAssets;
    configuration: Configuration;
    crawlerData: CrawlerData;
    fileInfo: FileInfo;
    localState?: NfoLocalState;
    signal?: AbortSignal;
    signalService: Pick<RuntimeScrapeSignalService, "showLogText" | "setProgress">;
  }) => Promise<DownloadedAssets>;
  prepareScrapeItem?: PrepareScrapeItem;
  onCommitted?: (runId: string, result: ScrapeResult) => void;
  onInvalidate?: (runs: Array<{ run: ScrapeRunRecord; snapshot: ScrapeRunSnapshotDto }>) => void;
  onTerminal?: (run: ScrapeRunRecord, snapshot: ScrapeRunSnapshotDto) => Promise<void> | void;
  onError?: (runId: string, error: unknown) => Promise<void> | void;
  aggregationService?: Pick<AggregationService, "aggregate">;
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

export class ScrapeRunner {
  private readonly runContexts = new Map<string, ScrapeRunContext>();
  private readonly rootDisplayNames = new Map<string, string>();
  private readonly logger: RuntimeLogger;
  private readonly translateService: TranslateService;
  private readonly nfoGenerator = new NfoGenerator();
  private readonly fileOrganizer = new FileOrganizer();
  private readonly probeVideo: ReturnType<typeof createVideoProbe>;
  private coordinatorInstance: RunnerCoordinator | null = null;
  private closed = false;
  private readonly terminalSnapshots = new Map<string, ScrapeRunSnapshotDto>();
  private lastTerminalSnapshot: ScrapeRunSnapshotDto | null = null;
  private readonly host: ScrapeHostPort<
    ScrapeRunnerStartContext,
    ScrapeRunManifest,
    RunnerScrapeItem,
    PreparedMovieGroup
  >;

  constructor(private readonly deps: ScrapeRunnerDependencies) {
    const rawLogger = deps.logger ?? runtimeLoggerService.getLogger("ScrapeRunner");
    this.logger = {
      debug: (msg: string) => rawLogger.debug?.(msg),
      info: (msg: string) => rawLogger.info(msg),
      warn: (msg: string, error?: unknown) => rawLogger.warn(msg, error),
      error: (msg: string, error?: unknown) => rawLogger.error(msg, error),
    };
    this.probeVideo = createVideoProbe(deps.mediaInfoWasmPath);
    this.translateService = new TranslateService(deps.networkClient, {
      logger: this.logger,
      mappingStore: deps.mappingStore,
    });

    this.host = {
      create: (input) => this.createRun(input),
      retry: (runId, itemIds) => this.createRetryRun(runId, itemIds),
      rerunDirectory: async (runId) => {
        const configuration = structuredClone(await this.deps.getConfiguration());
        const target = toPublicationTarget(this.runLibrary(await this.deps.persistence.scrapeRuns.get(runId)));
        assertTargetLayout(configuration, target);
        const run = await this.deps.persistence.scrapeRuns.rerunDirectory(runId);
        this.runContexts.set(run.id, { configuration, target });
        return run;
      },
      runId: (run) => run.id,
      describe: (run) => ({ totalItems: run.manifestFixedAt ? run.items.length : null }),
      discover: (run, signal, onProgress) => this.discoverRun(run, signal, onProgress),
      createExecution: (run, reporter, signal) => this.createExecution(run, reporter, signal),
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
        this.runContexts.delete(run.id);
        await this.deps.onTerminal?.(run, dto);
      },
      onError: async (runId, error) => {
        this.logger.error(`Scrape execution failed for ${runId}: ${toErrorMessage(error)}`);
        await this.deps.onError?.(runId, error);
      },
    };
  }

  async start(input: ScrapeStartInput): Promise<StartScrapeResult> {
    if (this.closed) throw new Error("Scrape queue is closing");
    const configuration = structuredClone(await this.deps.getConfiguration());
    const normalized = await this.normalizeStartInput(input, configuration);
    const snapshot = await (await this.coordinator()).start({ normalized, configuration });
    return await this.accepted(snapshot.runId, "start", snapshot.progress.totalItems);
  }

  async retry(runId: string, itemIds?: readonly string[]): Promise<StartScrapeResult> {
    const snapshot = await (await this.bindExistingRun(runId)).retry(runId, itemIds);
    return await this.accepted(
      snapshot.runId,
      "retry",
      snapshot.progress.totalItems === null
        ? null
        : snapshot.items.filter((item) => item.status === "pending" || item.status === "processing").length,
    );
  }

  async rerunDirectory(runId: string): Promise<StartScrapeResult> {
    const snapshot = await (await this.bindExistingRun(runId)).rerunDirectory(runId);
    return await this.accepted(snapshot.runId, "rerun", null);
  }

  async stop(runId?: string): Promise<{ pendingCount: number }> {
    const target = this.liveRun(runId);
    if (!target) return { pendingCount: 0 };

    const pendingCount = target.snapshot.items.filter(
      (item) => !["success", "failed", "skipped"].includes(item.status),
    ).length;
    await this.coordinatorInstance?.stop(target.run.id);
    return { pendingCount };
  }

  async pause(runId?: string): Promise<void> {
    const target = this.liveRun(runId);
    if (!target) throw new Error("No live scrape task to pause");
    await this.coordinatorInstance?.pause(target.run.id);
  }

  async resume(runId?: string): Promise<void> {
    const target = this.liveRun(runId);
    if (!target) throw new Error("No live scrape task to resume");
    await this.coordinatorInstance?.resume(target.run.id);
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
    const live = this.liveRun(taskId);
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
    const manifests = this.deps.persistence.scrapeRuns.listHistory(input?.taskId);
    const runs: ScrapeHistoryRunDto[] = [];
    const results: ScrapeResultDto[] = [];
    for (const manifest of manifests) {
      const root = await this.deps.persistence.mediaRoots.get(manifest.rootId);
      runs.push({
        id: manifest.id,
        rootId: manifest.rootId,
        rootDisplayName: root.displayName,
        requestedOutputRootId: manifest.requestedOutputRootId,
        outputRootId: manifest.requestedOutputRootId,
        executionMode: manifest.executionMode,
        disposition: manifest.disposition ?? "interrupted",
        createdAt: manifest.createdAt.toISOString(),
        startedAt: manifest.startedAt?.toISOString() ?? null,
        completedAt: manifest.completedAt?.toISOString() ?? null,
        successCount: manifest.successCount,
        failedCount: manifest.failedCount,
        skippedCount: manifest.skippedCount,
        totalBytes: manifest.totalBytes,
        error: manifest.error,
      });
      const snapshot = this.terminalSnapshots.get(manifest.id);
      for (const item of snapshot?.items ?? []) {
        if (item.status === "pending" || item.status === "processing") continue;
        results.push({
          id: item.resultId ?? item.id,
          taskId: manifest.id,
          rootId: item.rootId,
          rootDisplayName: root.displayName,
          outputRootId: item.outputRootId,
          relativePath: item.relativePath,
          fileName: item.fileName,
          status: item.status,
          error: item.error,
          crawlerData: item.crawlerData,
          nfoRootId: item.nfoRootId,
          nfoRelativePath: item.nfoRelativePath,
          outputRelativePath: item.outputRelativePath,
          assets: item.assets,
          manualUrl: item.manualUrl,
          persistenceState: "terminal",
          createdAt: manifest.createdAt.toISOString(),
          updatedAt: (manifest.completedAt ?? manifest.createdAt).toISOString(),
        });
      }
    }
    return { runs, results };
  }

  async result(id: string): Promise<ScrapeResultDetailResponse> {
    const live = await this.getSnapshot();
    let snapshotItem: ScrapeLiveItemDto | undefined = live?.items.find(
      (item: ScrapeLiveItemDto) => item.id === id || item.resultId === id,
    );
    let snapshotTaskId = live?.task.id ?? "";
    let snapshotCreatedAt = live?.task.createdAt ?? "";
    let snapshotUpdatedAt = live?.task.updatedAt ?? "";

    if (!snapshotItem) {
      for (const terminal of this.terminalSnapshots.values()) {
        const item = terminal.items.find((candidate) => candidate.id === id || candidate.resultId === id);
        if (item) {
          snapshotItem = item;
          snapshotTaskId = terminal.task.id;
          snapshotCreatedAt = terminal.task.createdAt;
          snapshotUpdatedAt = terminal.task.updatedAt;
          break;
        }
      }
    }

    if (snapshotItem) {
      const root = await this.deps.persistence.mediaRoots.get(snapshotItem.rootId).catch(() => null);
      return {
        result: {
          id: snapshotItem.id,
          taskId: snapshotTaskId,
          rootId: snapshotItem.rootId,
          rootDisplayName: root?.displayName ?? snapshotItem.rootId,
          outputRootId: snapshotItem.outputRootId,
          relativePath: snapshotItem.relativePath,
          fileName: snapshotItem.fileName,
          status:
            snapshotItem.status === "pending" || snapshotItem.status === "processing" ? "failed" : snapshotItem.status,
          error: snapshotItem.error,
          crawlerData: snapshotItem.crawlerData,
          nfoRootId: snapshotItem.nfoRootId,
          nfoRelativePath: snapshotItem.nfoRelativePath,
          outputRelativePath: snapshotItem.outputRelativePath,
          assets: snapshotItem.assets,
          manualUrl: snapshotItem.manualUrl,
          persistenceState: "terminal",
          createdAt: snapshotCreatedAt,
          updatedAt: snapshotUpdatedAt,
        },
      };
    }

    const entry =
      (await this.deps.persistence.library.getEntryByFileId(id).catch(() => null)) ??
      (await this.deps.persistence.library.getEntryById(id).catch(() => null));
    if (entry) {
      const file = entry.files.find((f) => f.id === id) ?? entry.files[0];
      const nfoAsset = entry.assets.find((a) => a.kind === "nfo");
      const crawlerData = entry.crawlerDataJson ? (JSON.parse(entry.crawlerDataJson) as CrawlerData) : null;
      const root = await this.deps.persistence.mediaRoots.get(file.rootId).catch(() => null);
      return {
        result: {
          id,
          taskId: "",
          rootId: file.rootId,
          rootDisplayName: root?.displayName ?? file.rootId,
          outputRootId: file.rootId,
          relativePath: file.rootRelativePath,
          fileName: file.fileName,
          status: "success",
          error: null,
          crawlerData,
          nfoRootId: nfoAsset?.rootId ?? null,
          nfoRelativePath: nfoAsset?.relativePath ?? null,
          outputRelativePath: file.rootRelativePath,
          assets: entry.assets.map((asset) =>
            asset.rootId && asset.relativePath
              ? { type: "local", kind: asset.kind, file: { rootId: asset.rootId, relativePath: asset.relativePath } }
              : { type: "remote", kind: asset.kind, url: asset.uri },
          ),
          manualUrl: null,
          persistenceState: "terminal",
          createdAt: entry.createdAt.toISOString(),
          updatedAt: (entry.lastRefreshedAt ?? entry.createdAt).toISOString(),
        },
      };
    }

    throw new Error(`Scrape result not found: ${id}`);
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
    input: ScrapeStartInput,
    configuration: Configuration,
  ): Promise<NormalizedScrapeStart> {
    const library = this.deps.persistence.libraries.get(input.libraryId);
    assertTargetLayout(configuration, toPublicationTarget(library));
    if ("source" in input) {
      const directoryScope = createDirectoryScope(
        input.source,
        library.placement === "inPlace" ? input.source.scanDir : library.outputPath,
        configuration,
      );
      const scan = await this.deps.persistence.mediaRoots.admitDirectory({ hostPath: directoryScope.scanDir });
      this.rootDisplayNames.set(scan.root.id, scan.root.displayName);
      return { library, mode: "directory", scope: directoryScope, rootId: scan.root.id };
    }

    if (!input.refs[0]) throw new ScrapeRunnerError("NO_FILES", "No files selected");
    if (input.executionMode === "single" && input.refs.length !== 1)
      throw new ScrapeRunnerError("INVALID_ARGUMENT", "A single scrape takes exactly one file");
    return {
      library,
      mode: input.executionMode,
      refs: input.refs,
      manualUrl: input.manualUrl,
      number: input.number,
      unpin: input.unpin,
    };
  }

  /** In place, output stays in each file's own root; otherwise it goes to the library's output directory. */
  private async libraryOutput(
    library: MediaLibraryRecord,
    sourceRootId: string,
  ): Promise<{ outputRootId: string; outputRelativeDirectory: string | null }> {
    if (library.placement === "inPlace") return { outputRootId: sourceRootId, outputRelativeDirectory: null };
    const output = await this.deps.persistence.mediaRoots.prepareOutputDirectory({ hostPath: library.outputPath });
    return { outputRootId: output.id, outputRelativeDirectory: output.relativeDirectory || null };
  }

  private async createRun(input: ScrapeRunnerStartContext): Promise<ScrapeRunManifest> {
    const { normalized, configuration } = input;
    const { library } = normalized;
    const target = toPublicationTarget(library);

    if (normalized.mode === "directory") {
      const run = await this.deps.persistence.scrapeRuns.create({
        libraryId: library.id,
        rootId: normalized.rootId,
        ...(await this.libraryOutput(library, normalized.rootId)),
        executionMode: "batch",
        directoryScopeJson: JSON.stringify(normalized.scope),
        items: [],
      });
      this.runContexts.set(run.id, { configuration, target });
      return run;
    }

    const canonicalRefs = await this.deps.persistence.mediaRoots.canonicalizeFileRefs(normalized.refs);
    const inventory = new DirectoryInventory();
    const manualScrape = resolveManualScrapeRoute(normalized.manualUrl, configuration.network);
    const groups = await admitScrapeGroups({
      refs: canonicalRefs.map((ref) => ({ ...ref, manualScrape, number: normalized.number })),
      resolveRoot: (id) => this.deps.persistence.mediaRoots.get(id),
      inventory,
      configuration,
    });

    const members = groups.flatMap((group) => group.members);
    const rootId = members[0]?.source.rootId ?? canonicalRefs[0]?.rootId;
    if (!rootId) throw new ScrapeRunnerError("NO_FILES", "No files selected");
    const root = await this.deps.persistence.mediaRoots.get(rootId);
    this.rootDisplayNames.set(root.id, root.displayName);

    const manifest = await this.deps.persistence.scrapeRuns.create({
      libraryId: library.id,
      rootId,
      ...(await this.libraryOutput(library, rootId)),
      executionMode: normalized.mode,
      items: members.map((member, ordinal) => ({
        id: member.fileId,
        ordinal,
        rootId: member.source.rootId,
        relativePath: member.source.relativePath,
        manualUrl: normalized.manualUrl ?? null,
        number: normalized.number ?? null,
      })),
    });

    this.runContexts.set(manifest.id, { configuration, target, unpin: normalized.unpin, inventory, groups });
    return manifest;
  }

  /** Retries and reruns publish with the library's current settings, like a new run. */
  private runLibrary(run: ScrapeRunRecord): MediaLibraryRecord {
    if (!run.libraryId) throw new Error("This scrape run has no library; start a new scrape instead");
    return this.deps.persistence.libraries.get(run.libraryId);
  }

  private async createRetryRun(runId: string, itemIds?: readonly string[]): Promise<ScrapeRunManifest> {
    const run = await this.deps.persistence.scrapeRuns.get(runId);
    if (!run.disposition || run.disposition === "interrupted") {
      throw new Error(`Only completed, failed, or stopped scrape runs can be retried: ${run.id}`);
    }
    if (!run.manifestFixedAt)
      throw new Error("Directory file list has not been generated; cannot retry, please rescan directory");
    if (itemIds?.length === 0) throw new Error(`Scrape retry requires at least one item: ${run.id}`);

    // A retry run only holds the retried items, so the batch is the union of the whole retry chain with newer runs winning.
    const lineage = [run];
    for (let previousId = run.previousRunId; previousId; previousId = lineage[0].previousRunId) {
      lineage.unshift(await this.deps.persistence.scrapeRuns.get(previousId));
    }
    const itemKey = (item: { rootId: string; relativePath: string }) => `${item.rootId}\0${item.relativePath}`;
    const batchItems = new Map<string, (typeof run.items)[number]>();
    const itemsById = new Map<string, (typeof run.items)[number]>();
    for (const ancestor of lineage) {
      for (const item of ancestor.items) {
        batchItems.set(itemKey(item), item);
        itemsById.set(item.id, item);
      }
    }
    const configuration = structuredClone(await this.deps.getConfiguration());
    const seedKeys = new Set<string>();
    if (itemIds) {
      for (const itemId of itemIds) {
        const item = itemsById.get(itemId);
        if (!item) throw new Error(`Scrape item does not belong to run ${run.id}: ${itemId}`);
        seedKeys.add(itemKey(item));
      }
    } else {
      const statusByKey = new Map<string, string>();
      for (const ancestor of lineage) {
        const snapshot = this.terminalSnapshots.get(ancestor.id);
        if (!snapshot && ancestor === run)
          throw new Error("Task results are no longer in this session; please rescan directory");
        for (const item of snapshot?.items ?? []) statusByKey.set(itemKey(item), item.status);
      }
      for (const [key, status] of statusByKey) if (status === "failed" || status === "skipped") seedKeys.add(key);
    }
    const seedIds = [...seedKeys].flatMap((key) => batchItems.get(key)?.id ?? []);
    const inventory = new DirectoryInventory();
    const directories = new Map<string, string>();
    for (const item of batchItems.values()) {
      const root = await this.deps.persistence.mediaRoots.get(item.rootId);
      const directory = dirname(resolveRootRelativePath(root, item.relativePath));
      directories.set(item.id, filesystemPathKey(await inventory.canonicalDirectory(directory)));
    }
    const retryIds = new Set(
      expandScrapeRetryItems([...batchItems.values()], seedIds, configuration.scrape.filenameIgnoreTokens, (item) => {
        const directory = directories.get(item.id);
        if (!directory) throw new Error(`Retry item has no directory identity: ${item.id}`);
        return directory;
      }),
    );
    const itemsToRetry = [...batchItems.values()].filter((item) => retryIds.has(item.id));
    if (itemsToRetry.length === 0) throw new Error(`Scrape run has no failed or skipped items to retry: ${run.id}`);
    const library = this.runLibrary(run);
    const target = toPublicationTarget(library);
    assertTargetLayout(configuration, target);
    const groups = await admitScrapeGroups({
      refs: itemsToRetry.map((item) => ({
        rootId: item.rootId,
        relativePath: item.relativePath,
        manualScrape: resolveManualScrapeRoute(item.manualUrl, configuration.network),
        uncensoredChoice: item.uncensoredChoice ?? undefined,
        number: item.number ?? undefined,
      })),
      resolveRoot: (id) => this.deps.persistence.mediaRoots.get(id),
      inventory,
      configuration,
    });
    const members = groups.flatMap((group) => group.members);

    const manifest = await this.deps.persistence.scrapeRuns.create({
      previousRunId: run.id,
      libraryId: library.id,
      rootId: run.rootId,
      ...(await this.libraryOutput(library, run.rootId)),
      executionMode: run.executionMode,
      items: members.map((member, ordinal) => {
        const original = itemsToRetry.find(
          (item) => item.rootId === member.source.rootId && item.relativePath === member.source.relativePath,
        );
        return {
          id: member.fileId,
          ordinal,
          rootId: member.source.rootId,
          relativePath: member.source.relativePath,
          manualUrl: member.manualScrape?.detailUrl ?? original?.manualUrl ?? null,
          uncensoredChoice: original?.uncensoredChoice ?? null,
          number: original?.number ?? null,
        };
      }),
    });
    this.runContexts.set(manifest.id, { configuration, target, inventory, groups });
    return manifest;
  }

  private async discoverRun(
    run: ScrapeRunManifest,
    signal: AbortSignal,
    onProgress: (progress: DiscoveryProgress) => void,
  ): Promise<ScrapeRunManifest> {
    if (!run.directoryScopeJson) throw new Error("Directory run is missing its scope");
    const context = this.runContexts.get(run.id);
    if (!context) throw new Error(`Scrape run is not prepared: ${run.id}`);

    const repository = this.deps.persistence;
    const checkRoots = repository.mediaRoots.rootIntegrityGuard();
    context.rootGuard = checkRoots;
    const found = await discoverDirectoryFiles({
      scope: directoryTaskScopeSchema.parse(JSON.parse(run.directoryScopeJson)),
      configuration: context.configuration,
      mediaRoots: repository.mediaRoots,
      checkRoots,
      signal,
      onProgress,
      platform: this.deps.platform ?? "desktop",
    });

    const groups = await admitScrapeGroups({
      refs: found.refs,
      resolveRoot: (id) => repository.mediaRoots.get(id),
      inventory: found.inventory,
      configuration: context.configuration,
      expandParts: false,
    });
    const manifest = await repository.scrapeRuns.fixManifest({
      runId: run.id,
      signal,
      discoveryJson: JSON.stringify(found.discovery),
      items: groups
        .flatMap((group) => group.members)
        .map((member, ordinal) => ({
          ...member.source,
          id: member.fileId,
          ordinal,
        })),
    });
    context.groups = groups;
    context.inventory = found.inventory;
    return manifest;
  }

  private async createExecution(
    manifest: ScrapeRunManifest,
    reporter: ScrapeWorkflowReporter,
    signal?: AbortSignal,
  ): Promise<ScrapeRunExecution<RunnerScrapeItem, PreparedMovieGroup>> {
    const outputRootIds = manifest.requestedOutputRootId ? [manifest.requestedOutputRootId] : [];
    const context = this.runContexts.get(manifest.id);
    if (!context?.inventory || !context.groups) throw new Error(`Scrape run is not prepared: ${manifest.id}`);
    const checkRoots = context.rootGuard ?? this.deps.persistence.mediaRoots.rootIntegrityGuard();
    const { inventory, groups } = context;
    this.runContexts.delete(manifest.id);
    await checkRoots([...new Set([...manifest.items.map((item) => item.rootId), ...outputRootIds])]);

    const { configuration, target, unpin } = context;
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

    const fileScraper = new FileScraper(
      {
        aggregationService:
          this.deps.aggregationService ??
          new AggregationService(this.deps.crawlerProvider, {
            config: configuration,
            logger: this.logger,
            signal,
            recordSiteResults: this.deps.recordSiteResults,
          }),
        translateService: this.translateService,
        nfoGenerator: this.nfoGenerator,
        buildTags: buildMovieTags,
        downloadManager: new DownloadManager(this.deps.networkClient, {
          imageHostCooldownStore: this.deps.imageHostCooldownStore,
          logger: this.logger,
        }),
        fileOrganizer: this.fileOrganizer,
        findExistingMovie: async (targetVideoPath, number, sourcePaths) => {
          const directory = dirname(targetVideoPath);
          const sources = new Set(
            await Promise.all(
              sourcePaths.map(async (sourcePath) => filesystemPathKey(await inventory.entryPath(sourcePath))),
            ),
          );
          const entries = await inventory.mediaEntries(directory);
          // A source already at its target (an in-place re-scrape) is the version being scraped, not a sibling.
          const refs = (
            await Promise.all(
              entries
                .filter((entry) => versionKey(join(directory, entry.name)) === versionKey(targetVideoPath))
                .map(async (entry) => {
                  const videoPath = join(directory, entry.name);
                  return {
                    ...toRootFileRef(videoPath, [...roots.values()]),
                    entryIdentity: filesystemPathKey(await inventory.entryPath(videoPath)),
                  };
                }),
            )
          ).filter((ref) => !sources.has(ref.entryIdentity));
          const ownership = this.deps.persistence.library.inventoryOwnership(refs);
          const [movieId, ...others] = new Set(ownership.map((entry) => entry.movieId));
          if (!movieId || others.length) return undefined;
          const movie = await this.deps.persistence.library.getEntryById(movieId);
          if (movie.number?.trim().toUpperCase() !== number.trim().toUpperCase()) return undefined;
          return {
            movieId,
            assets: ownership
              .filter((entry) => entry.kind !== "video")
              .map((entry) => ({
                rootId: entry.rootId,
                relativePath: entry.relativePath,
                fileId: entry.fileId,
                kind: entry.kind,
                published: Boolean(entry.published),
              })),
          };
        },
        signalService: {
          setProgress: (value, current) => reporter.progress(manifest.items[current - 1]?.id ?? "", value),
          showLogText: () => undefined,
          showScrapeStep: () => undefined,
          showFailedInfo: () => undefined,
        },
        actorImageService: this.deps.actorImageService,
        actorSourceProvider: this.deps.actorSourceProvider,
        getConfiguration: async () => configuration,
        logger: this.logger,
        postProcessAssets: this.deps.postProcessAssets,
        probeVideoMetadata: async (sourcePath) =>
          await this.probeVideo(sourcePath).catch((error: unknown) => {
            this.logger.warn(`Video probe failed: ${toErrorMessage(error)}`);
            return undefined;
          }),
      },
      {
        mode: manifest.executionMode,
        scrapeSessionId: manifest.id,
        inventory,
      },
    );

    const requireRoot = (id: string): MediaRoot => {
      const root = roots.get(id);
      if (!root) throw new Error(`Media root not found: ${id}`);
      return root;
    };
    const scrapeOptions = {
      configuration,
      roots: [...roots.values()],
      scrapeSessionId: manifest.id,
      unpin,
      target:
        target.placement === "inPlace"
          ? target
          : {
              ...target,
              outputPath: resolveRootRelativePath(outputRoot, manifest.requestedOutputRelativeDirectory ?? ""),
            },
    };

    const movieGroups: MovieGroup<RunnerScrapeItem>[] = groups.map((group) => ({
      ...group,
      members: group.members.map((member) => {
        const item: RunnerScrapeItem = {
          ...member,
          ...member.source,
          id: member.fileId,
          sourcePath: resolveRootRelativePath(requireRoot(member.source.rootId), member.source.relativePath),
        };
        return this.deps.prepareScrapeItem?.(item) ?? item;
      }),
    }));

    return {
      concurrency: manifest.executionMode === "single" ? 1 : policy.concurrency,
      movieGroups,
      prepareGroup: async (group, signal) => {
        await policy.restGate?.waitBeforeStart(signal);
        const result = await fileScraper.prepareGroup(
          group.members.map((member) => {
            const uncensoredChoice = member.uncensoredChoice;
            return {
              filePath: member.sourcePath,
              fileInfo: member.fileInfo,
              groupMovieId: group.movieId,
              groupFileId: member.fileId,
              groupAssets: group.assets,
              progress: {
                fileIndex: 1,
                totalFiles: manifest.items.length,
                onProgress: (percent: number) => reporter.progress(member.id, percent),
              },
              options: {
                ...scrapeOptions,
                source: { rootId: member.rootId, relativePath: member.relativePath },
                manualScrape: member.manualScrape,
                localState: uncensoredChoice ? { uncensoredChoice } : undefined,
                itemId: member.id,
                operationId: `${manifest.id}:${member.id}`,
                signalService: {
                  setProgress: (value: number) => reporter.progress(member.id, value),
                  showLogText: (message: string) => this.logger.info(message),
                  showScrapeStep: (step) => reporter.stage({ itemId: member.id, stage: step }),
                  showFailedInfo: ({ error }) => this.logger.warn(error),
                },
              },
            };
          }),
          signal,
        );
        return result.status === "prepared" ? result : { status: result.status, result };
      },
      checkTargets: async (preparedGroups) => {
        await checkScrapeTargets(
          preparedGroups.map(({ prepared }) => ({
            members: prepared.members.map((member) => ({
              itemId: member.itemId,
              sourcePath: member.fileInfo.filePath,
              targetVideoPath: member.outputPlan.targetVideoPath,
              artifactPaths: prepared.artifactPaths,
            })),
          })),
          inventory,
        );
      },
      executePreparedGroup: async ({ group, prepared }, signal) => {
        const executed = await fileScraper.executePreparedFiles(prepared, signal);
        return {
          ...executed,
          results: executed.results.map((result, index) => ({
            itemId: group.members[index]?.id ?? result.fileId,
            result,
          })),
        };
      },
      commitItems: async (entries, output) => {
        if (!output) {
          let added = 0;
          const committed = entries.map((entry) => {
            if (!entry.result) throw new Error(`Scrape item has no terminal result: ${entry.item.id}`);
            const result = { ...entry.result, resultId: entry.item.id };
            if (result.status === "failed") {
              const pending = result.pending ?? { kind: "failed", number: entry.item.fileInfo.number || undefined };
              const isNew = this.deps.persistence.pending.upsert({
                kind: pending.kind,
                rootId: entry.item.rootId,
                relativePath: entry.item.relativePath,
                libraryId: manifest.libraryId,
                number: pending.number ?? null,
                detail: result.error ?? null,
                candidatesJson: pending.candidates?.length ? JSON.stringify(pending.candidates) : null,
              });
              if (isNew) added += 1;
            }
            this.deps.onCommitted?.(manifest.id, result);
            return { itemId: entry.item.id, result };
          });
          if (added) this.deps.onPending?.(added);
          return committed;
        }

        if (!output.scrape) throw new Error("Scrape output requires movie metadata");
        const committedMovie = toCommittedMovie(output, output.scrape);
        const completedAt = new Date();
        const committedFiles = new Map(committedMovie.files.map((file) => [file.fileId, file]));

        const libraryEntries = output.files.map((video) => {
          const facts = video.scrape;
          if (!facts) throw new Error("Scrape file has no prepared facts");
          const file = committedFiles.get(video.fileId);
          if (!file) throw new Error(`Committed movie omitted file: ${video.fileId}`);
          return {
            fileId: file.fileId,
            entryIdentity: file.entryIdentity,
            sourceEntryIdentity: file.sourceEntryIdentity,
            retainedSourceIdentity: file.retainedSourceIdentity,
            rootId: file.rootId,
            rootRelativePath: file.rootRelativePath,
            size: file.size,
            modifiedAt: file.modifiedAtMs === null ? null : new Date(file.modifiedAtMs),
            partNumber: file.partNumber,
            partSuffix: file.partSuffix,
            resolution: file.resolution,
            assets: committedMovie.assets.filter((asset) => asset.fileId === file.fileId),
            lastKnownPath: facts.identity.relativePath,
          };
        });

        const uncensoredAmbiguous = output.files.some((f) => f.scrape?.uncensoredAmbiguous);
        let uncensoredPendingAdded = false;

        const commit = () => {
          const published = libraryEntries[0];
          const result = this.deps.persistence.pending.commitPublication(
            {
              id: committedMovie.id,
              assets: committedMovie.assets.filter((asset) => asset.fileId === null),
              mediaIdentity: committedMovie.mediaIdentity,
              number: committedMovie.number,
              title: committedMovie.title,
              actors: [...committedMovie.actors],
              crawlerDataJson: committedMovie.crawlerDataJson,
              createdAt: completedAt,
            },
            libraryEntries,
            {
              clearFiles: entries.map((entry) => entry.item),
              uncensored: uncensoredAmbiguous
                ? {
                    rootId: published.rootId,
                    relativePath: published.rootRelativePath,
                    libraryId: manifest.libraryId,
                    number: committedMovie.number,
                  }
                : undefined,
            },
          );
          uncensoredPendingAdded = result.uncensoredAdded;
        };

        const release = await acquireOutputDirectories(
          [...output.moves.map((move) => move.targetPath), ...output.artifacts.map((artifact) => artifact.targetPath)],
          (directory) => inventory.canonicalDirectory(directory),
        );
        try {
          if (output.moves.length > 0) {
            await new MoveOutput(undefined, this.logger).install({
              moves: output.moves,
              artifacts: output.artifacts,
              protectedMediaFiles: output.protectedMediaFiles,
              commit,
            });
          } else {
            await new WriteOutput(undefined, this.logger).install(output.artifacts, {
              protectedMediaFiles: output.protectedMediaFiles,
              commit,
            });
          }
        } finally {
          release();
        }
        if (uncensoredPendingAdded) this.deps.onPending?.(1);
        const publishedDirectory = (ref: RootFileRef) =>
          dirname(resolveRootRelativePath(requireRoot(ref.rootId), ref.relativePath));
        this.deps.onPublished?.(
          output.scrape.nfo
            ? [publishedDirectory(output.scrape.nfo)]
            : [...new Set(output.files.map((file) => publishedDirectory(file.target)))],
          configuration,
        );

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
            fileId: libraryEntries[output.files.indexOf(video)].fileId,
            resultId: libraryEntries[output.files.indexOf(video)].fileId,
            size: video.size,
            status: "success",
            crawlerData: output.scrape?.crawlerData,
            sources: output.scrape?.sources,
            videoMeta: facts.videoMeta,
            nfo: output.scrape?.nfo,
            ...(facts.uncensoredAmbiguous ? { pending: { kind: "uncensored", number: committedMovie.number } } : {}),
            output: video.target,
            assets: movieOutputResultAssets(output, video),
          };
          try {
            this.deps.onCommitted?.(manifest.id, result);
          } catch (error) {
            this.logger.warn(`Scrape committed but notification failed: ${toErrorMessage(error)}`);
          }
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
    const root = await this.deps.persistence.mediaRoots.get(manifest.rootId);
    this.rootDisplayNames.set(root.id, root.displayName);
    const completedItems = manifest.successCount + manifest.failedCount + manifest.skippedCount;
    return {
      task: {
        id: manifest.id,
        kind: "scrape",
        rootId: manifest.rootId,
        rootDisplayName: root.displayName,
        revision: 0,
        status: manifest.disposition ?? "interrupted",
        createdAt: manifest.createdAt.toISOString(),
        updatedAt: (manifest.completedAt ?? manifest.createdAt).toISOString(),
        startedAt: manifest.startedAt?.toISOString() ?? null,
        completedAt: manifest.completedAt?.toISOString() ?? null,
        totalItems: manifest.manifestFixedAt ? manifest.totalItems : null,
        successCount: manifest.successCount,
        failedCount: manifest.failedCount,
        skippedCount: manifest.skippedCount,
        error: manifest.error,
        continuity: !manifest.disposition || manifest.disposition === "interrupted" ? "interrupted" : "final",
        previousTaskId: manifest.previousRunId,
        libraryId: manifest.libraryId,
      },
      directorySource: manifest.directoryScopeJson
        ? directoryTaskScopeSchema.parse(JSON.parse(manifest.directoryScopeJson))
        : null,
      discovery: manifest.discoveryJson ? (JSON.parse(manifest.discoveryJson) as DiscoveryProgress) : null,
      progress: {
        completedItems,
        totalItems: manifest.manifestFixedAt ? manifest.totalItems : null,
        percent: !manifest.manifestFixedAt
          ? null
          : manifest.totalItems === 0
            ? 0
            : Math.round((completedItems / manifest.totalItems) * 100),
      },
      items: [],
      latestStage: null,
      logs: [],
    };
  }

  private liveRun(runId?: string) {
    const runs = this.coordinatorInstance?.liveRuns() ?? [];
    return runId ? runs.find(({ run }) => run.id === runId) : runs[0];
  }

  private async bindExistingRun(runId: string): Promise<RunnerCoordinator> {
    if (!runId.trim()) throw new ScrapeRunnerError("NO_FILES", "No scrape run selected");
    if (this.closed) throw new Error("Scrape queue is closing");
    this.deps.imageHostCooldownStore.clear?.();
    const previousRun = await this.deps.persistence.scrapeRuns.get(runId);
    const root = await this.deps.persistence.mediaRoots.get(previousRun.rootId);
    this.rootDisplayNames.set(root.id, root.displayName);
    return await this.coordinator();
  }

  private async accepted(runId: string, action: string, totalFiles: number | null): Promise<StartScrapeResult> {
    const snapshot = await this.getSnapshot(runId);
    if (!snapshot) throw new Error(`Scrape task disappeared after ${action}: ${runId}`);
    return { taskId: runId, totalFiles, snapshot };
  }
}
