import { dirname, resolve } from "node:path";
import { type Configuration, configManager } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import { OutputLibraryScanner } from "@main/services/library";
import { createDesktopMediaRootService } from "@main/services/mediaRoots";
import { DesktopPersistenceService } from "@main/services/persistence";
import type { SignalService } from "@main/services/SignalService";
import { didPromiseTimeout } from "@main/utils/async";
import { type MediaRoot, toRootRelativePath } from "@mdcz/media-store";
import type { ScrapeRunManifest } from "@mdcz/persistence";
import type { ActorSourceProvider } from "@mdcz/runtime/actorSource";
import type { PersistentCooldownStore } from "@mdcz/runtime/cooldown";
import type { CrawlerProvider } from "@mdcz/runtime/crawler";
import { type ConfiguredMediaRootService, mediaPathOwnership } from "@mdcz/runtime/library";
import { buildMovieTags } from "@mdcz/runtime/maintenance";
import type { NetworkClient } from "@mdcz/runtime/network";
import { commitScrapeTerminalResults, registeredOutputPaths } from "@mdcz/runtime/publication";
import type { ScrapeExecutionMode } from "@mdcz/runtime/scrape";
import {
  type ActorImageService,
  AggregationService,
  applyScrapeNetworkPolicy,
  buildScrapePublicationKey,
  createDirectoryScope,
  createScrapeExecutionPolicy,
  DownloadManager,
  discoverDirectoryFiles,
  NfoGenerator,
  type PreparedFileScrape,
  scrapeMovieGroupKey,
  TranslateService,
  validatePreparedScrapeFiles,
} from "@mdcz/runtime/scrape";
import {
  resolveScrapeAttempts,
  resolveScrapeRetry,
  ScrapeCoordinator,
  type ScrapeHostExecution,
  type ScrapeHostPort,
  type ScrapeRunItem,
  type ScrapeRunItemInitialState,
  type ScrapeRunSnapshot,
  type ScrapeWorkflowReporter,
  toFinalizedScrapeRunSnapshot,
  toScrapeResultFromOutcome,
  toScrapeRunSnapshotDto,
} from "@mdcz/runtime/tasks";
import { configurationSchema } from "@mdcz/shared/config";
import type { DirectoryTaskScope } from "@mdcz/shared/directoryTasks";
import { directoryTaskScopeSchema } from "@mdcz/shared/directoryTasks";
import type { ScraperStartInput } from "@mdcz/shared/ipc-contracts/scraperContract";
import { resolveManualScrapeRoute } from "@mdcz/shared/manualScrapeUrl";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { ScrapeConfirmUncensoredInput, ScrapeRunSnapshotDto } from "@mdcz/shared/serverDtos";
import type { ScrapeResult, UncensoredConfirmResponse } from "@mdcz/shared/types";
import { confirmUncensoredRunItems } from "./confirmUncensored";
import { createFileScraper, fileOrganizer } from "./FileScraper";
import type { ManualScrapeOptions } from "./manualScrape";
import { resolveSingleFilePaths } from "./pathResolver";
import { ScraperServiceError } from "./ScraperServiceError";
import { translationMappingStore } from "./translationMappingStore";

export interface StartScrapeResult {
  taskId: string;
  totalFiles: number | null;
  snapshot: ScrapeRunSnapshotDto;
}
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

interface DesktopScrapeStart {
  directoryScope?: DirectoryTaskScope;
  rootId?: string;
  refs: RootFileRef[];
  mode: ScrapeExecutionMode;
  configuration: Configuration;
  outputRootId: string;
  outputRelativeDirectory?: string;
  manualUrl?: string;
}

export class ScraperService {
  private readonly logger = loggerService.getLogger("ScraperService");
  private readonly actorImageService: ActorImageService;
  private readonly actorSourceProvider: ActorSourceProvider | undefined;
  private readonly sharedNetworkClient: NetworkClient;
  private readonly aggregationService: AggregationService;
  private readonly imageHostCooldownStore: PersistentCooldownStore;
  private readonly mediaRoots: ConfiguredMediaRootService;
  private readonly host: ScrapeHostPort<DesktopScrapeStart, ScrapeRunManifest, ManualScrapeOptions, PreparedFileScrape>;
  private workflow: ScrapeCoordinator<
    DesktopScrapeStart,
    ScrapeRunManifest,
    ManualScrapeOptions,
    PreparedFileScrape
  > | null = null;
  private terminalSnapshot: ScrapeRunSnapshotDto | null = null;
  private closed = false;

  constructor(
    private readonly signalService: SignalService,
    networkClient: NetworkClient,
    crawlerProvider: CrawlerProvider,
    actorImageService: ActorImageService,
    actorSourceProvider: ActorSourceProvider | undefined,
    imageHostCooldownStore: PersistentCooldownStore,
    private readonly outputLibraryScanner = new OutputLibraryScanner(),
    private readonly persistenceService = new DesktopPersistenceService(),
    mediaRoots?: ConfiguredMediaRootService,
    private readonly prepareScrapeItem: <T extends { relativePath: string; caseId?: string }>(item: T) => T = (item) =>
      item,
  ) {
    this.actorImageService = actorImageService;
    this.actorSourceProvider = actorSourceProvider;
    this.sharedNetworkClient = networkClient;
    this.aggregationService = new AggregationService(crawlerProvider, { logger: this.logger });
    this.imageHostCooldownStore = imageHostCooldownStore;
    this.mediaRoots = mediaRoots ?? createDesktopMediaRootService(this.persistenceService);
    this.host = {
      create: async (input) => await this.createRun(input),
      runId: (run) => run.id,
      describe: (run) => ({
        executionGeneration: run.executionGeneration,
        totalItems: run.manifestFixedAt ? run.items.length : null,
      }),
      discover: async (run, signal, onProgress) => {
        if (!run.directoryScopeJson || !run.configurationJson)
          throw new Error("Directory run is missing its scope or configuration");
        const repository = (await this.persistenceService.getState()).repositories;
        const generatedStrms = await registeredOutputPaths(repository.library, (id) => this.mediaRoots.get(id), "strm");
        const found = await discoverDirectoryFiles({
          scope: directoryTaskScopeSchema.parse(JSON.parse(run.directoryScopeJson)),
          configuration: configurationSchema.parse(JSON.parse(run.configurationJson)),
          mediaRoots: this.mediaRoots,
          generatedStrms,
          signal,
          onProgress,
          platform: "desktop",
        });
        return await repository.scrapeRuns.fixManifest({
          runId: run.id,
          signal,
          discoveryJson: JSON.stringify(found.discovery),
          items: found.refs.map((ref, ordinal) => ({ ...ref, ordinal })),
        });
      },
      createExecution: async (run, reporter) => await this.createExecution(run, reporter),
      onInvalidate: (runs) => {
        const live = runs[0];
        this.signalService.publishTaskSnapshot({
          resource: "scrape",
          snapshot: live ? this.toSnapshotDto(live.run, live.snapshot, live.startedAt) : this.terminalSnapshot,
        });
      },
      onTerminal: async (run, snapshot) => this.handleTerminalRun(run, snapshot),
      onError: async (runId, error) => {
        this.logger.error(`Scrape execution failed for ${runId}`, error);
      },
    };
  }

  async getSnapshot(taskId?: string): Promise<ScrapeRunSnapshotDto | null> {
    const runs = this.workflow?.liveRuns() ?? [];
    const live = taskId ? runs.find(({ run }) => run.id === taskId) : runs[0];
    if (live) return this.toSnapshotDto(live.run, live.snapshot, live.startedAt);
    if (this.terminalSnapshot && (!taskId || this.terminalSnapshot.task.id === taskId)) return this.terminalSnapshot;
    const repository = (await this.persistenceService.getState()).repositories.scrapeRuns;
    const manifest = await repository.getLatestFinalized();
    if (!manifest?.directoryScopeJson || (taskId && manifest.id !== taskId)) return null;
    this.terminalSnapshot = await this.rebuildTerminalSnapshot(manifest.id);
    return this.terminalSnapshot;
  }

  async confirmUncensored(input: ScrapeConfirmUncensoredInput): Promise<UncensoredConfirmResponse> {
    const configuration = await configManager.getValidated();
    if (!configuration.download.generateNfo) {
      throw new ScraperServiceError("INVALID_ARGUMENT", "已关闭 NFO 生成功能，无法确认无码类型");
    }
    const state = await this.persistenceService.getState();
    const manifest = await state.repositories.scrapeRuns.get(input.taskId);
    const response = await confirmUncensoredRunItems({ manifest, items: input.items, configuration, state });
    this.terminalSnapshot = await this.rebuildTerminalSnapshot(input.taskId);
    this.signalService.publishTaskSnapshot({ resource: "scrape", snapshot: this.terminalSnapshot });
    this.outputLibraryScanner.invalidate();
    return response;
  }

  async start(input: ScraperStartInput): Promise<StartScrapeResult> {
    const configuration = structuredClone(await configManager.getValidated());
    if (input.mode === "directory") {
      const directoryScope = createDirectoryScope(input.source, input.targetDir, configuration);
      const root = await this.mediaRoots.registerPathIntent(directoryScope.scanDir);
      const output = await this.mediaRoots.registerPathIntent(directoryScope.targetDir);
      return await this.begin({
        directoryScope,
        rootId: root.id,
        refs: [],
        mode: "batch",
        configuration,
        outputRootId: output.id,
        outputRelativeDirectory: toRootRelativePath(output, directoryScope.targetDir),
      });
    }
    const refs = input.mode === "single" ? [input.ref] : input.refs;
    if (refs.length === 0) throw new ScraperServiceError("NO_FILES", "No files selected");
    return await this.begin({
      refs,
      manualUrl: input.manualUrl,
      mode: input.mode === "single" ? "single" : "batch",
      configuration,
      outputRootId: input.mode === "single" ? input.ref.rootId : input.outputRootId,
      outputRelativeDirectory: input.mode === "single" ? "" : input.outputRelativeDirectory,
    });
  }

  async startFromNativePath(nativePath: string): Promise<StartScrapeResult> {
    const files = await resolveSingleFilePaths([nativePath]);
    const filePath = files[0];
    if (!filePath) throw new ScraperServiceError("NO_FILES", "No files selected");
    const root = await this.mediaRoots.ensurePathRecord({ hostPath: dirname(filePath) });
    return await this.start({
      mode: "single",
      ref: { rootId: root.id, relativePath: toRootRelativePath(root, filePath) },
    });
  }

  async stop(): Promise<{ pendingCount: number }> {
    const live = this.workflow?.liveRuns()[0];
    if (!live) return { pendingCount: 0 };
    const pendingCount = live.snapshot.items.filter(
      (item) => !["success", "failed", "skipped"].includes(item.status),
    ).length;
    this.signalService.invalidate("scrape", "overview");
    await this.workflow?.stop(live.run.id);
    return { pendingCount };
  }

  async waitForIdle(): Promise<void> {
    await this.workflow?.waitForIdle();
  }

  async shutdown(options: { timeoutMs?: number } = {}): Promise<void> {
    const timeoutMs = Math.max(0, Math.trunc(options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS));
    this.logger.info("Shutting down scraper service");
    this.closed = true;
    if (this.workflow && (await didPromiseTimeout(this.workflow.abortForShutdown(), timeoutMs))) {
      this.logger.warn(`Timed out waiting ${timeoutMs}ms for scraper service shutdown`);
    }
    await this.imageHostCooldownStore.flush();
  }

  async pause(): Promise<void> {
    const live = this.workflow?.liveRuns()[0];
    if (live) await this.workflow?.pause(live.run.id);
  }

  async resume(): Promise<void> {
    const live = this.workflow?.liveRuns()[0];
    if (live?.snapshot.status === "paused") await this.workflow?.resume(live.run.id);
  }

  async retry(runId: string, itemIds?: readonly string[], rediscover = false): Promise<StartScrapeResult> {
    if (!runId.trim()) throw new ScraperServiceError("NO_FILES", "No scrape run selected for retry");
    const configuration = await configManager.getValidated();
    this.clearImageHostCooldownsForRetry();
    this.configureRuntimeSettings(configuration);
    const workflow = await this.coordinator();
    const snapshot = rediscover ? await workflow.rerunDirectory(runId) : await workflow.retry(runId, itemIds);
    const initialSnapshot = await this.getSnapshot(snapshot.runId);
    if (!initialSnapshot) throw new Error(`Scrape task disappeared after retry: ${snapshot.runId}`);
    this.signalService.invalidate("scrape", "overview");
    return {
      taskId: snapshot.runId,
      snapshot: initialSnapshot,
      totalFiles:
        snapshot.progress.totalItems === null
          ? null
          : snapshot.items.filter((item) => item.status === "pending" || item.status === "processing").length,
    };
  }

  private async begin(input: DesktopScrapeStart): Promise<StartScrapeResult> {
    this.configureRuntimeSettings(input.configuration);
    const snapshot = await (await this.coordinator()).start(input);
    const initialSnapshot = await this.getSnapshot(snapshot.runId);
    if (!initialSnapshot) throw new Error(`Scrape task disappeared after start: ${snapshot.runId}`);
    this.signalService.invalidate("scrape", "overview");
    return { taskId: snapshot.runId, totalFiles: snapshot.progress.totalItems, snapshot: initialSnapshot };
  }

  private async coordinator(): Promise<
    ScrapeCoordinator<DesktopScrapeStart, ScrapeRunManifest, ManualScrapeOptions, PreparedFileScrape>
  > {
    if (this.closed) throw new Error("Scrape queue is closing");
    if (this.workflow) return this.workflow;
    const state = await this.persistenceService.initialize();
    this.workflow = new ScrapeCoordinator(state.repositories.scrapeRuns, this.host);
    return this.workflow;
  }

  private createFileScraperDependencies(
    recordProgress: (value: number, current: number, total: number) => void,
    getConfiguration?: () => Promise<Configuration>,
  ) {
    return {
      aggregationService: this.aggregationService,
      translateService: new TranslateService(this.sharedNetworkClient, {
        logger: loggerService.getLogger("TranslateService"),
        mappingStore: translationMappingStore,
      }),
      nfoGenerator: new NfoGenerator(),
      buildTags: buildMovieTags,
      downloadManager: new DownloadManager(this.sharedNetworkClient, {
        imageHostCooldownStore: this.imageHostCooldownStore,
        logger: loggerService.getLogger("DownloadManager"),
      }),
      fileOrganizer,
      signalService: {
        setProgress: (value: number, current: number, total: number) => {
          recordProgress(value, current, total);
        },
        showFailedInfo: () => this.signalService.invalidate("scrape"),
        showLogText: this.signalService.showLogText.bind(this.signalService),
        showScrapeInfo: () => this.signalService.invalidate("scrape"),
        showScrapeResult: () => this.signalService.invalidate("scrape"),
      },
      actorImageService: this.actorImageService,
      actorSourceProvider: this.actorSourceProvider,
      getConfiguration,
    };
  }

  private configureRuntimeSettings(configuration: Configuration): void {
    applyScrapeNetworkPolicy(this.sharedNetworkClient, configuration);
  }

  private async createRun(input: DesktopScrapeStart): Promise<ScrapeRunManifest> {
    const rootId = input.rootId ?? input.refs[0]?.rootId;
    if (!rootId) throw new ScraperServiceError("NO_FILES", "No files selected");
    const state = await this.persistenceService.getState();
    return await state.repositories.scrapeRuns.create({
      rootId,
      outputRootId: input.outputRootId,
      outputRelativeDirectory: input.outputRelativeDirectory || null,
      executionMode: input.mode,
      configurationJson: JSON.stringify(input.configuration),
      directoryScopeJson: input.directoryScope ? JSON.stringify(input.directoryScope) : undefined,
      items: input.refs.map((ref, ordinal) => ({
        ordinal,
        rootId: ref.rootId,
        relativePath: ref.relativePath,
        manualUrl: input.manualUrl ?? null,
      })),
    });
  }

  private async createExecution(
    manifest: ScrapeRunManifest,
    reporter: ScrapeWorkflowReporter,
  ): Promise<ScrapeHostExecution<ManualScrapeOptions, PreparedFileScrape>> {
    const configuration = configurationSchema.parse(JSON.parse(manifest.configurationJson ?? "null"));
    this.configureRuntimeSettings(configuration);
    const policy = createScrapeExecutionPolicy(configuration, { logger: this.logger });
    const state = await this.persistenceService.getState();
    const roots = new Map<string, MediaRoot>();
    for (const item of manifest.items) {
      if (!roots.has(item.rootId)) roots.set(item.rootId, await state.repositories.mediaRoots.get(item.rootId));
    }
    if (!manifest.requestedOutputRootId) throw new Error(`Scrape run has no output root: ${manifest.id}`);
    const outputRoot = await state.repositories.mediaRoots.get(manifest.requestedOutputRootId);
    roots.set(outputRoot.id, outputRoot);
    const metadataPath = configuration.paths.metadataPath.trim();
    if (metadataPath) {
      const metadataRoot = await this.mediaRoots.ensurePathRecord({ hostPath: metadataPath });
      roots.set(metadataRoot.id, metadataRoot);
    }
    const runConfiguration: Configuration = {
      ...configuration,
      paths: {
        ...configuration.paths,
        mediaPath: outputRoot.hostPath,
        successOutputFolder: manifest.requestedOutputRelativeDirectory ?? "",
      },
    };
    const { openAttemptByItemId, latestOutcomeByItemId } = resolveScrapeAttempts(manifest);
    const initialItems: ScrapeRunItemInitialState<ManualScrapeOptions>[] = manifest.items.map((item) => {
      const outcome = latestOutcomeByItemId.get(item.id);
      if (openAttemptByItemId.has(item.id) || !outcome) return { id: item.id, status: "pending", error: null };
      return {
        id: item.id,
        status: outcome.outcome,
        error: outcome.error,
        result: toScrapeResultFromOutcome(item, outcome),
      };
    });
    const items: ScrapeRunItem<ManualScrapeOptions>[] = await Promise.all(
      manifest.items.map(async (item) => {
        const root = roots.get(item.rootId);
        if (!root) throw new Error(`Scrape root disappeared before session creation: ${item.rootId}`);
        const retrying = openAttemptByItemId.has(item.id);
        const execution = await resolveScrapeRetry({
          item,
          retrying,
          latestOutcome: latestOutcomeByItemId.get(item.id),
          outputRoot: outputRoot,
          outputRelativeDirectory: manifest.requestedOutputRelativeDirectory ?? "",
          failedOutputFolder: configuration.paths.failedOutputFolder,
          resolveRoot: async (id) => {
            const resolved = roots.get(id) ?? (await state.repositories.mediaRoots.get(id));
            roots.set(id, resolved);
            return resolved;
          },
        });
        return this.prepareScrapeItem({
          id: item.id,
          rootId: item.rootId,
          relativePath: item.relativePath,
          ...execution,
          manualScrape: resolveManualScrapeRoute(item.manualUrl),
        });
      }),
    );
    const itemIndexById = new Map(items.map((item, index) => [item.id, index + 1]));
    const librarySources = new Map(
      await Promise.all(
        items.map(
          async (item) =>
            [item.id, await state.repositories.library.resolveMaintenanceSource(item.sourcePath)] as const,
        ),
      ),
    );
    const fileScraper = createFileScraper(
      this.createFileScraperDependencies(
        (value, current) => {
          const item = items[current - 1];
          if (item) reporter.progress(item.id, value);
        },
        async () => runConfiguration,
      ),
      { mode: manifest.executionMode, scrapeSessionId: manifest.id },
    );
    return {
      items,
      initialItems,
      executionGeneration: manifest.executionGeneration,
      concurrency: manifest.executionMode === "single" ? 1 : policy.concurrency,
      admitItem: async (item: ScrapeRunItem<ManualScrapeOptions>) => {
        const existing = openAttemptByItemId.get(item.id);
        if (existing) return existing;
        const attempt = state.repositories.scrapeRuns.admitAttempt(item.id);
        openAttemptByItemId.set(item.id, attempt.id);
        return attempt.id;
      },
      prepareItem: async (item: ScrapeRunItem<ManualScrapeOptions>, signal: AbortSignal, attemptId: string) => {
        await policy.restGate?.waitBeforeStart(signal);
        const progress = { fileIndex: itemIndexById.get(item.id) ?? 1, totalFiles: items.length };
        const result = await fileScraper.prepareFile(item.sourcePath, progress, signal, {
          ...(item.manualScrape ? { manualScrape: item.manualScrape } : {}),
          source: item.executionSource ?? { rootId: item.rootId, relativePath: item.relativePath },
          roots: [...roots.values()],
          operationId: `${manifest.id}:${attemptId}`,
          outputDirectory: item.manualScrape
            ? resolve(runConfiguration.paths.mediaPath, runConfiguration.paths.successOutputFolder)
            : undefined,
          outputTemplateRoot: item.outputTemplateRoot,
        });
        if (result.status === "prepared") return result;
        return {
          status: result.status,
          result: { ...result, fileId: item.id, rootId: item.rootId, relativePath: item.relativePath },
        };
      },
      validatePrepared: async (
        prepared: readonly { item: ScrapeRunItem<ManualScrapeOptions>; prepared: PreparedFileScrape }[],
        failedItems: readonly ScrapeRunItem<ManualScrapeOptions>[],
      ) =>
        await validatePreparedScrapeFiles([
          ...prepared.map(({ item, prepared }) => ({
            itemId: item.id,
            sourcePath: prepared.sourcePath,
            libraryItemId: librarySources.get(item.id)?.libraryItemId,
            outputPlan: prepared.outputPlan,
            mediaIdentity: prepared.crawlerData.number || prepared.fileInfo.number,
            partNumber: prepared.fileInfo.part?.number ?? null,
          })),
          ...(runConfiguration.behavior.failedFileMove
            ? failedItems.map((item) => ({
                itemId: item.id,
                sourcePath: item.sourcePath,
                outputPlan: {
                  targetVideoPath: fileOrganizer.resolveFailedVideoPath(
                    item.sourcePath,
                    outputRoot.hostPath,
                    runConfiguration,
                  ),
                },
              }))
            : []),
        ]),
      acquireItems: (items) =>
        mediaPathOwnership.acquireAll(
          items.map((item) => item.executionSource ?? { rootId: item.rootId, relativePath: item.relativePath }),
          items
            .map((item) => item.id)
            .sort()
            .join(","),
        ),
      getPublicationKey: (_item: ScrapeRunItem<ManualScrapeOptions>, prepared: PreparedFileScrape) =>
        buildScrapePublicationKey(prepared.outputPlan),
      getExecutionGroupKey: (item: ScrapeRunItem<ManualScrapeOptions>, prepared: PreparedFileScrape) =>
        scrapeMovieGroupKey({
          libraryItemId: librarySources.get(item.id)?.libraryItemId,
          sourcePath: prepared.sourcePath,
          mediaIdentity: prepared.crawlerData.number || prepared.fileInfo.number,
        }),
      executePreparedItems: async (entries, signal) => {
        const results = await fileScraper.executePreparedFiles(
          entries.map(({ item, prepared }) => ({
            prepared: {
              ...prepared,
              identity: { ...prepared.identity, fileId: item.id, rootId: item.rootId, relativePath: item.relativePath },
            },
            progress: { fileIndex: itemIndexById.get(item.id) ?? 1, totalFiles: items.length },
            caseId: item.caseId,
          })),
          signal,
        );
        return results.map((result) => ({ itemId: result.fileId, result }));
      },
      commitPreparationItem: async (
        _item: ScrapeRunItem<ManualScrapeOptions>,
        result: ScrapeResult,
        attemptId: string,
      ) => {
        if (result.status !== "failed" && result.status !== "skipped") {
          throw new Error("Preparation can only commit failed or skipped results");
        }
        const outcome = state.repositories.scrapeRuns.commitOutcome({
          attemptId,
          ...(result.status === "failed"
            ? { outcome: "failed", error: result.error?.trim() || "刮削预检失败" }
            : { outcome: "skipped", error: result.error ?? null }),
        });
        return { ...result, resultId: outcome.id };
      },
      commitItems: async (entries) => {
        const committed = await commitScrapeTerminalResults({
          items: entries.map(({ item, result, attemptId }) => {
            return {
              result: result,
              attemptId,
              itemPath: item.relativePath,
              fileTransitions: fileOrganizer.createScrapeFileTransitions({
                configuration: runConfiguration,
                failureRootPath: outputRoot.hostPath,
                sourcePath: item.sourcePath,
              }),
            };
          }),
          scrapeRuns: state.repositories.scrapeRuns,
          resolveRoot: async (rootId) => await state.repositories.mediaRoots.get(rootId),
          acquireAll: (refs) =>
            mediaPathOwnership.acquireAll(
              refs,
              entries
                .map(({ item }) => item.id)
                .sort()
                .join(","),
            ),
          journal: state.repositories.publicationJournal,
          outputs: state.repositories.library,
          repairIssues: state.repositories.libraryRepairIssues,
        });
        return committed.map((result) => ({ itemId: result.fileId, result }));
      },
    };
  }

  private handleTerminalRun(manifest: ScrapeRunManifest, snapshot: ScrapeRunSnapshot<ManualScrapeOptions>): void {
    this.terminalSnapshot = this.toSnapshotDto(manifest, snapshot, manifest.startedAt);
    this.signalService.publishTaskSnapshot({ resource: "scrape", snapshot: this.terminalSnapshot });
    this.logger.info(`Scrape run finished: ${snapshot.runId}`);
    this.outputLibraryScanner.invalidate();
    this.aggregationService.clearCache();
    this.signalService.invalidate("scrape", "overview");
  }

  private async rebuildTerminalSnapshot(runId: string): Promise<ScrapeRunSnapshotDto> {
    const state = await this.persistenceService.getState();
    const manifest = await state.repositories.scrapeRuns.get(runId);
    const summary = state.repositories.scrapeRuns.summary(manifest);
    if (!summary) throw new Error(`Scrape run is not finished: ${runId}`);
    const outcomes = await Promise.all(
      state.repositories.scrapeRuns.latestOutcomes(manifest).map(async (outcome) => ({
        ...outcome,
        assets: (await state.repositories.library.getEntryBySourceOutcomeId(outcome.id))?.assets ?? [],
      })),
    );
    return this.toSnapshotDto(
      manifest,
      toFinalizedScrapeRunSnapshot({
        id: manifest.id,
        executionGeneration: manifest.executionGeneration,
        revision: manifest.revision,
        items: manifest.items,
        outcomes,
        disposition: summary.disposition,
        error: summary.error,
      }),
      summary.startedAt,
    );
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
      rootDisplayName: manifest.rootId,
      completedAt: manifest.completedAt,
    });
  }

  private clearImageHostCooldownsForRetry(): void {
    this.imageHostCooldownStore.clear();
    this.logger.info("Cleared image host cooldowns for user-initiated retry");
  }
}
