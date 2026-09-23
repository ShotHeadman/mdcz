import { dirname } from "node:path";
import { filesystemPathKey, type MediaRoot, resolveRootRelativePath } from "@mdcz/media-store";
import type { LibraryRepository, ScrapeRunManifest, ScrapeRunRecord, ScrapeRunRepository } from "@mdcz/persistence";
import { type Configuration, configurationSchema } from "@mdcz/shared/config";
import {
  type DirectorySource,
  type DirectoryTaskScope,
  type DiscoveryProgress,
  directoryTaskScopeSchema,
} from "@mdcz/shared/directoryTasks";
import { toErrorMessage } from "@mdcz/shared/error";
import { resolveManualScrapeRoute } from "@mdcz/shared/manualScrapeUrl";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type {
  ScrapeConfirmUncensoredInput,
  ScrapeHistoryResponse,
  ScrapeHistoryRunDto,
  ScrapeLiveItemDto,
  ScrapeLiveRunsResponse,
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
  UncensoredChoice,
  UncensoredConfirmResponse,
  VideoMeta,
} from "@mdcz/shared/types";
import type { ConfiguredMediaRootService } from "../library/mediaRootService";
import { MaintenanceRuntime } from "../maintenance/MaintenanceRuntime";
import { buildMovieTags } from "../maintenance/movieTags";
import type { NetworkClient } from "../network";
import { committedMovieRows, toCommittedMovie } from "../publication/committedMovie";
import { MoveOutput } from "../publication/MoveOutput";
import { movieOutputResultAssets } from "../publication/outputLibrary";
import { acquireOutputDirectories } from "../publication/outputMutex";
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
import { AggregationService } from "./aggregation";
import { DirectoryInventory } from "./DirectoryInventory";
import { createDirectoryScope, discoverDirectoryFiles } from "./directoryDiscovery";
import { DownloadManager, type ImageHostCooldownStore } from "./download";
import { applyScrapeNetworkPolicy, createScrapeExecutionPolicy } from "./executionPolicy";
import { FileOrganizer } from "./FileOrganizer";
import { FileScraper, type PreparedMovieGroup, type RuntimeScrapeSignalService } from "./FileScraper";
import { admitScrapeGroups, type MovieGroup } from "./movieGroups";
import { NfoGenerator } from "./nfo";
import { checkScrapeTargets } from "./preflightScrapeTask";
import { TranslateService } from "./TranslateService";
import type { TranslationMappingStore } from "./translate/types";
import { expandScrapeRetryItems } from "./utils/number";

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

type ScrapeRunContext = {
  inventory?: DirectoryInventory;
  groups?: MovieGroup[];
  rootGuard?: ReturnType<ConfiguredMediaRootService["rootIntegrityGuard"]>;
};
type RunnerManualScrape = ReturnType<typeof resolveManualScrapeRoute>;
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
    mediaRoots: ConfiguredMediaRootService;
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
    this.translateService = new TranslateService(deps.networkClient, {
      logger: this.logger,
      mappingStore: deps.mappingStore,
    });

    this.host = {
      create: (input) => this.createRun(input),
      retry: (runId, itemIds) => this.createRetryRun(runId, itemIds),
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

  async start(input: ScrapeRunnerStartInput): Promise<StartScrapeResult> {
    if (this.closed) throw new Error("Scrape queue is closing");
    const configuration = structuredClone(await this.deps.getConfiguration());
    applyScrapeNetworkPolicy(this.deps.networkClient, configuration);

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
          uncensoredAmbiguous: item.uncensoredAmbiguous,
          persistenceState: "terminal",
          createdAt: manifest.createdAt.toISOString(),
          updatedAt: (manifest.completedAt ?? manifest.createdAt).toISOString(),
        });
      }
    }
    return { runs, results };
  }

  async pendingUncensoredConfirmation(): Promise<ScrapePendingUncensoredConfirmationResponse> {
    const entries = await this.deps.persistence.library.listPendingUncensored();
    return {
      items: entries.flatMap((entry) => {
        const data = entry.crawlerDataJson ? (JSON.parse(entry.crawlerDataJson) as CrawlerData) : null;
        const nfo = entry.assets.find((asset) => asset.kind === "nfo");
        return entry.files.map((file) => ({
          id: file.id,
          ref: { rootId: file.rootId, relativePath: file.rootRelativePath },
          fileId: file.id,
          fileName: file.fileName,
          number: data?.number ?? entry.number ?? file.fileName,
          title: data?.title_zh ?? data?.title ?? entry.title,
          nfoRelativePath: nfo?.relativePath ?? null,
        }));
      }),
    };
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
          uncensoredAmbiguous: snapshotItem.uncensoredAmbiguous,
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
          uncensoredAmbiguous: entry.uncensoredAmbiguous,
          persistenceState: "terminal",
          createdAt: entry.createdAt.toISOString(),
          updatedAt: (entry.lastRefreshedAt ?? entry.createdAt).toISOString(),
        },
      };
    }

    throw new Error(`Scrape result not found: ${id}`);
  }

  async confirmUncensored(input: ScrapeConfirmUncensoredInput): Promise<UncensoredConfirmResponse> {
    const configuration = await this.deps.getConfiguration();
    if (!configuration.download.generateNfo)
      throw new ScrapeRunnerError("INVALID_ARGUMENT", "已关闭 NFO 生成功能，无法确认无码类型");
    const selected = new Map<
      string,
      { entry: Awaited<ReturnType<LibraryRepository["getEntryById"]>>; choice: UncensoredChoice }
    >();
    for (const item of input.items) {
      const entry = await this.deps.persistence.library.getEntryByFileId(item.fileId);
      const previous = selected.get(entry.id);
      if (previous && previous.choice !== item.choice) throw new Error("同一影片不能选择不同的无码类型");
      selected.set(entry.id, { entry, choice: item.choice });
    }
    const roots = await this.deps.persistence.mediaRoots.listRoots();
    const rootsById = new Map(roots.map((root) => [root.id, root]));
    await this.deps.persistence.mediaRoots.assertRootIntegrity(
      new Set(
        [...selected.values()].flatMap(({ entry }) => [
          ...entry.files.map((file) => file.rootId),
          ...entry.assets.flatMap((asset) => asset.rootId ?? []),
        ]),
      ),
    );
    const maintenance = new MaintenanceRuntime({
      actorImageService: this.deps.actorImageService,
      actorSourceProvider: this.deps.actorSourceProvider,
      config: { get: async () => configuration },
      fileOrganizer: this.fileOrganizer,
      nfoGenerator: this.nfoGenerator,
      signalService: { setProgress: () => undefined, showLogText: () => undefined },
    });
    const updatedItems: UncensoredConfirmResponse["items"] = [];
    for (const { entry, choice } of selected.values()) {
      const root = rootsById.get(entry.files[0]?.rootId ?? "");
      if (!root) throw new Error("影片缺少有效媒体文件");
      const result = await maintenance.applyLibraryEntry({
        root,
        presetId: "local_organize",
        preserveRegisteredMetadata: true,
        entry,
        localState: { uncensoredChoice: choice },
        publication: {
          roots,
          identity: {
            movieId: entry.id,
            assets: entry.assets.flatMap((asset) =>
              asset.rootId && asset.relativePath
                ? [
                    {
                      rootId: asset.rootId,
                      relativePath: asset.relativePath,
                      fileId: asset.fileId,
                      kind: asset.kind,
                      published: asset.published,
                    },
                  ]
                : [],
            ),
          },
          commit: (movie) => {
            const rows = committedMovieRows(movie);
            this.deps.persistence.library.writeEntry({ ...rows.movie, uncensoredAmbiguous: false }, rows.files);
          },
        },
      });
      if (result.status === "failed" || !result.output) throw new Error(result.error ?? "无码确认维护应用失败");
      const updates = new Map<
        string,
        Pick<ScrapeResult, "output" | "nfo" | "assets" | "crawlerData" | "uncensoredAmbiguous">
      >();
      for (const file of result.output.files) {
        const previous = entry.files.find((candidate) => candidate.id === file.fileId);
        const sourceRoot = previous && rootsById.get(previous.rootId);
        const targetRoot = rootsById.get(file.target.rootId);
        if (!previous || !sourceRoot || !targetRoot) throw new Error(`Missing published library file: ${file.fileId}`);
        const assets = movieOutputResultAssets(result.output, file);
        const nfo = assets.find((asset) => asset.type === "local" && asset.kind === "nfo");
        updates.set(file.fileId, {
          output: file.target,
          nfo: nfo?.type === "local" ? nfo.file : undefined,
          assets,
          crawlerData: result.crawlerData,
          uncensoredAmbiguous: false,
        });
        updatedItems.push({
          fileId: file.fileId,
          sourceVideoPath: resolveRootRelativePath(sourceRoot, previous.rootRelativePath),
          targetVideoPath: resolveRootRelativePath(targetRoot, file.target.relativePath),
          targetNfoPath: result.output.nfoPath,
          choice,
        });
      }
      this.coordinatorInstance?.updateLibraryFiles(updates);
      for (const snapshot of this.terminalSnapshots.values()) {
        for (const item of snapshot.items) {
          const update = item.resultId ? updates.get(item.resultId) : undefined;
          if (!update) continue;
          item.outputRootId = update.output?.rootId ?? null;
          item.outputRelativePath = update.output?.relativePath ?? null;
          item.nfoRootId = update.nfo?.rootId ?? null;
          item.nfoRelativePath = update.nfo?.relativePath ?? null;
          item.assets = update.assets;
          item.crawlerData = update.crawlerData ?? null;
          item.uncensoredAmbiguous = false;
        }
        snapshot.ambiguousUncensoredItems = snapshot.ambiguousUncensoredItems.filter(
          (item) => !updates.has(item.fileId),
        );
      }
    }
    return { updatedCount: updatedItems.length, items: updatedItems };
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
    if ("source" in input) {
      const directoryScope = createDirectoryScope(
        input.source,
        "mode" in input ? (input.targetDir ?? input.source.scanDir) : input.targetDir,
        configuration,
      );
      const scan = await this.deps.persistence.mediaRoots.admitDirectory({ hostPath: directoryScope.scanDir });
      const output =
        directoryScope.targetDir === directoryScope.scanDir
          ? { id: scan.root.id, relativeDirectory: scan.relativeDirectory }
          : await this.deps.persistence.mediaRoots.prepareOutputDirectory({ hostPath: directoryScope.targetDir });
      this.rootDisplayNames.set(scan.root.id, scan.root.displayName);
      return {
        mode: "directory",
        scope: directoryScope,
        rootId: scan.root.id,
        outputRootId: output.id,
        outputRelativeDirectory: output.relativeDirectory,
      };
    }

    const refs = "mode" in input && input.mode === "single" ? [input.ref] : input.refs;
    const ref = refs[0];
    if (!ref) throw new ScrapeRunnerError("NO_FILES", "No files selected");
    const single =
      ("mode" in input && input.mode === "single") || ("executionMode" in input && input.executionMode === "single");
    const manualUrl = input.manualUrl;
    const outputRootId = "outputRootId" in input ? input.outputRootId : undefined;
    const outputRelativeDirectory = "outputRelativeDirectory" in input ? input.outputRelativeDirectory : undefined;
    if (single) {
      return { mode: "single", ref, manualUrl, outputRootId, outputRelativeDirectory };
    }
    return {
      mode: "batch",
      refs,
      manualUrl,
      outputRootId: outputRootId ?? ref.rootId,
      outputRelativeDirectory: outputRelativeDirectory ?? "",
    };
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
    const manualScrape = resolveManualScrapeRoute(normalized.manualUrl);
    const groups = await admitScrapeGroups({
      refs: canonicalRefs.map((ref) => ({ ...ref, manualScrape })),
      resolveRoot: (id) => this.deps.persistence.mediaRoots.get(id),
      inventory,
      configuration,
    });

    const members = groups.flatMap((group) => group.members);
    const rootId = members[0]?.source.rootId ?? canonicalRefs[0]?.rootId;
    if (!rootId) throw new ScrapeRunnerError("NO_FILES", "No files selected");
    const root = await this.deps.persistence.mediaRoots.get(rootId);
    this.rootDisplayNames.set(root.id, root.displayName);

    const outputRootId = normalized.mode === "single" ? (normalized.outputRootId ?? rootId) : normalized.outputRootId;
    const outputRelativeDirectory = normalized.outputRelativeDirectory || null;

    const manifest = await this.deps.persistence.scrapeRuns.create({
      rootId,
      outputRootId,
      outputRelativeDirectory,
      executionMode: normalized.mode,
      configurationJson: JSON.stringify(configuration),
      items: members.map((member, ordinal) => ({
        id: member.fileId,
        ordinal,
        rootId: member.source.rootId,
        relativePath: member.source.relativePath,
        manualUrl: normalized.manualUrl ?? null,
      })),
    });

    this.runContexts.set(manifest.id, { inventory, groups });
    return manifest;
  }

  private async createRetryRun(runId: string, itemIds?: readonly string[]): Promise<ScrapeRunManifest> {
    const run = await this.deps.persistence.scrapeRuns.get(runId);
    if (!run.disposition || run.disposition === "interrupted") {
      throw new Error(`Only completed, failed, or stopped scrape runs can be retried: ${run.id}`);
    }
    if (!run.manifestFixedAt) throw new Error("目录文件列表尚未生成，无法重试，请重新扫描目录");
    if (itemIds) {
      if (itemIds.length === 0) throw new Error(`Scrape retry requires at least one item: ${run.id}`);
      const unknownItemId = itemIds.find((itemId) => !run.items.some((item) => item.id === itemId));
      if (unknownItemId) throw new Error(`Scrape item does not belong to run ${run.id}: ${unknownItemId}`);
    }
    const configuration = JSON.parse(run.configurationJson ?? "{}");
    const seedIds = itemIds ?? this.failedOrSkippedItemIds(run.id);
    const inventory = new DirectoryInventory();
    const directories = new Map<string, string>();
    for (const item of run.items) {
      const root = await this.deps.persistence.mediaRoots.get(item.rootId);
      const directory = dirname(resolveRootRelativePath(root, item.relativePath));
      directories.set(item.id, filesystemPathKey(await inventory.canonicalDirectory(directory)));
    }
    const retryIds = new Set(
      expandScrapeRetryItems(run.items, seedIds, configuration.scrape?.filenameIgnoreTokens, (item) => {
        const directory = directories.get(item.id);
        if (!directory) throw new Error(`Retry item has no directory identity: ${item.id}`);
        return directory;
      }),
    );
    const itemsToRetry = run.items.filter((item) => retryIds.has(item.id));
    if (itemsToRetry.length === 0) throw new Error(`Scrape run has no failed or skipped items to retry: ${run.id}`);
    const groups = await admitScrapeGroups({
      refs: itemsToRetry.map((item) => ({
        rootId: item.rootId,
        relativePath: item.relativePath,
        manualScrape: resolveManualScrapeRoute(item.manualUrl),
        uncensoredChoice: item.uncensoredChoice ?? undefined,
      })),
      resolveRoot: (id) => this.deps.persistence.mediaRoots.get(id),
      inventory,
      configuration,
    });
    const members = groups.flatMap((group) => group.members);

    const manifest = await this.deps.persistence.scrapeRuns.create({
      previousRunId: run.id,
      rootId: run.rootId,
      outputRootId: run.requestedOutputRootId,
      outputRelativeDirectory: run.requestedOutputRelativeDirectory,
      executionMode: run.executionMode,
      configurationJson: run.configurationJson ?? undefined,
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
        };
      }),
    });
    this.runContexts.set(manifest.id, { inventory, groups });
    return manifest;
  }

  private failedOrSkippedItemIds(runId: string): string[] {
    const snapshot = this.terminalSnapshots.get(runId);
    if (!snapshot) throw new Error("该任务结果已不在本次会话，请重新扫描目录");
    return snapshot.items
      .filter((item) => item.status === "failed" || item.status === "skipped")
      .map((item) => item.id);
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
    const checkRoots = repository.mediaRoots.rootIntegrityGuard();
    this.runContexts.set(run.id, { rootGuard: checkRoots });
    const found = await discoverDirectoryFiles({
      scope: directoryTaskScopeSchema.parse(JSON.parse(run.directoryScopeJson)),
      configuration: configurationSchema.parse(JSON.parse(run.configurationJson)),
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
      configuration: configurationSchema.parse(JSON.parse(run.configurationJson)),
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
    const context = this.runContexts.get(run.id);
    if (!context) throw new Error(`Scrape run is not prepared: ${run.id}`);
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

    const fileScraper = new FileScraper(
      {
        aggregationService:
          this.deps.aggregationService ??
          new AggregationService(this.deps.crawlerProvider, {
            config: configuration,
            logger: this.logger,
            signal,
          }),
        translateService: this.translateService,
        nfoGenerator: this.nfoGenerator,
        buildTags: buildMovieTags,
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

    const requireRoot = (id: string): MediaRoot => {
      const root = roots.get(id);
      if (!root) throw new Error(`Media root not found: ${id}`);
      return root;
    };
    const scrapeOptions = {
      configuration,
      roots: [...roots.values()],
      scrapeSessionId: manifest.id,
      outputTemplateRoot: resolveRootRelativePath(outputRoot, manifest.requestedOutputRelativeDirectory ?? ""),
    };

    const movieGroups: MovieGroup<RunnerScrapeItem>[] = await Promise.all(
      groups.map(async (group) => ({
        ...group,
        members: await Promise.all(
          group.members.map(async (member) => {
            const item: RunnerScrapeItem = {
              ...member,
              ...member.source,
              id: member.fileId,
              sourcePath: resolveRootRelativePath(requireRoot(member.source.rootId), member.source.relativePath),
            };
            return this.deps.prepareScrapeItem ? await this.deps.prepareScrapeItem(item) : item;
          }),
        ),
      })),
    );

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
                  showScrapeInfo: ({ step, fileInfo }) =>
                    reporter.stage({ itemId: member.id, stage: step, message: fileInfo.fileName }),
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
        const executed = await fileScraper.executePreparedFiles(prepared, signal, group.members[0]?.caseId);
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
          return entries.map((entry) => {
            if (!entry.result) throw new Error(`Scrape item has no terminal result: ${entry.item.id}`);
            const result = { ...entry.result, resultId: entry.item.id };
            this.deps.onCommitted?.(manifest.id, result);
            return { itemId: entry.item.id, result };
          });
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

        const commit = () => {
          this.deps.persistence.library.writeEntry(
            {
              id: committedMovie.id,
              assets: committedMovie.assets.filter((asset) => asset.fileId === null),
              mediaIdentity: committedMovie.mediaIdentity,
              number: committedMovie.number,
              title: committedMovie.title,
              actors: [...committedMovie.actors],
              crawlerDataJson: committedMovie.crawlerDataJson,
              uncensoredAmbiguous,
              createdAt: completedAt,
            },
            libraryEntries,
          );
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
            uncensoredAmbiguous: facts.uncensoredAmbiguous,
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
      ambiguousUncensoredItems: [],
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
