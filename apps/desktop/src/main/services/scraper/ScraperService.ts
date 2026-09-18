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
import { registeredOutputPaths } from "@mdcz/runtime";
import type { ActorSourceProvider } from "@mdcz/runtime/actorSource";
import type { PersistentCooldownStore } from "@mdcz/runtime/cooldown";
import type { CrawlerProvider } from "@mdcz/runtime/crawler";
import type { ConfiguredMediaRootService } from "@mdcz/runtime/library";
import { buildMovieTags } from "@mdcz/runtime/maintenance";
import type { NetworkClient } from "@mdcz/runtime/network";
import type { ScrapeExecutionMode } from "@mdcz/runtime/scrape";
import {
  type ActorImageService,
  AggregationService,
  applyScrapeNetworkPolicy,
  createDirectoryScope,
  createScrapeExecution,
  createScrapeExecutionPolicy,
  DirectoryInventory,
  DownloadManager,
  discoverDirectoryFiles,
  NfoGenerator,
  type PreparedFileScrape,
  TranslateService,
} from "@mdcz/runtime/scrape";
import {
  ScrapeCoordinator,
  type ScrapeHostExecution,
  type ScrapeHostPort,
  type ScrapeRunSnapshot,
  type ScrapeWorkflowReporter,
  toFinalizedScrapeRunSnapshot,
  toScrapeRunSnapshotDto,
} from "@mdcz/runtime/tasks";
import { configurationSchema } from "@mdcz/shared/config";
import type { DirectoryTaskScope } from "@mdcz/shared/directoryTasks";
import { directoryTaskScopeSchema } from "@mdcz/shared/directoryTasks";
import type { ScraperStartInput } from "@mdcz/shared/ipc-contracts/scraperContract";
import { resolveManualScrapeRoute } from "@mdcz/shared/manualScrapeUrl";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { ScrapeConfirmUncensoredInput, ScrapeRunSnapshotDto } from "@mdcz/shared/serverDtos";
import type { UncensoredConfirmResponse } from "@mdcz/shared/types";
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
  private readonly discoveredInventories = new Map<string, DirectoryInventory>();

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
        const manifest = await repository.scrapeRuns.fixManifest({
          runId: run.id,
          signal,
          discoveryJson: JSON.stringify(found.discovery),
          items: found.refs.map((ref, ordinal) => ({ ...ref, ordinal })),
        });
        this.discoveredInventories.set(run.id, found.inventory);
        return manifest;
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
      refs: await this.mediaRoots.canonicalizeFileRefs(refs),
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

  async retry(runId: string, itemIds?: readonly string[]): Promise<StartScrapeResult> {
    return await this.relaunch(runId, (workflow) => workflow.retry(runId, itemIds));
  }

  async rerunDirectory(runId: string): Promise<StartScrapeResult> {
    return await this.relaunch(runId, (workflow) => workflow.rerunDirectory(runId));
  }

  private async relaunch(
    runId: string,
    launch: (workflow: NonNullable<ScraperService["workflow"]>) => Promise<ScrapeRunSnapshot<ManualScrapeOptions>>,
  ): Promise<StartScrapeResult> {
    if (!runId.trim()) throw new ScraperServiceError("NO_FILES", "No scrape run selected");
    const configuration = await configManager.getValidated();
    this.imageHostCooldownStore.clear();
    this.logger.info("Cleared image host cooldowns for user-initiated relaunch");
    this.configureRuntimeSettings(configuration);
    const workflow = await this.coordinator();
    const snapshot = await launch(workflow);
    const initialSnapshot = await this.getSnapshot(snapshot.runId);
    if (!initialSnapshot) throw new Error(`Scrape task disappeared after relaunch: ${snapshot.runId}`);
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
    const inventory = new DirectoryInventory();
    const refs = await inventory.admitRefs(await this.mediaRoots.canonicalizeFileRefs(input.refs), (id) =>
      this.mediaRoots.get(id),
    );
    const manifest = await state.repositories.scrapeRuns.create({
      rootId,
      outputRootId: input.outputRootId,
      outputRelativeDirectory: input.outputRelativeDirectory || null,
      executionMode: input.mode,
      configurationJson: JSON.stringify(input.configuration),
      directoryScopeJson: input.directoryScope ? JSON.stringify(input.directoryScope) : undefined,
      items: refs.map((ref, ordinal) => ({
        ordinal,
        rootId: ref.rootId,
        relativePath: ref.relativePath,
        manualUrl: input.manualUrl ?? null,
      })),
    });
    if (!input.directoryScope) this.discoveredInventories.set(manifest.id, inventory);
    return manifest;
  }

  private async createExecution(
    manifest: ScrapeRunManifest,
    reporter: ScrapeWorkflowReporter,
  ): Promise<ScrapeHostExecution<ManualScrapeOptions, PreparedFileScrape>> {
    const outputRootIds = manifest.requestedOutputRootId ? [manifest.requestedOutputRootId] : [];
    const checkRoots = this.mediaRoots.rootIntegrityGuard(
      manifest.directoryScopeJson ? [...manifest.items.map((item) => item.rootId), ...outputRootIds] : [],
    );
    await checkRoots(outputRootIds);
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
    const metadataPath = configuration.behavior.metadataOnly ? configuration.paths.metadataPath.trim() : "";
    if (metadataPath) {
      const metadataRoot = await this.mediaRoots.ensurePathRecord({ hostPath: metadataPath });
      await checkRoots([metadataRoot.id]);
      roots.set(metadataRoot.id, metadataRoot);
    }
    const inventory = this.discoveredInventories.get(manifest.id) ?? new DirectoryInventory();
    const fileScraper = createFileScraper(
      {
        ...this.createFileScraperDependencies(
          () => undefined,
          async () => configuration,
        ),
        outputs: state.repositories.library,
      },
      {
        mode: manifest.executionMode,
        scrapeSessionId: manifest.id,
        inventory,
      },
    );
    this.discoveredInventories.delete(manifest.id);
    return await createScrapeExecution<ManualScrapeOptions, PreparedFileScrape>({
      configuration,
      inventory,
      manifest,
      ownership: () => state.repositories.library.inventoryOwnership(),
      outputRoot,
      restGate: policy.restGate ?? undefined,
      resolveRoot: async (id) => {
        const root = roots.get(id) ?? (await state.repositories.mediaRoots.get(id));
        roots.set(id, root);
        return root;
      },
      enrichItem: async (item) => {
        const prepared = await this.prepareScrapeItem(item);
        await checkRoots([prepared.executionSource?.rootId ?? prepared.rootId]);
        return prepared;
      },
      manualScrape: (id) => resolveManualScrapeRoute(manifest.items.find((item) => item.id === id)?.manualUrl),
      fileScrape: (prepared) => prepared,
      admitAttempt: (id) => state.repositories.scrapeRuns.admitAttempt(id),
      publication: {
        scrapeRuns: state.repositories.scrapeRuns,
        journal: state.repositories.publicationJournal,
      },
      execution: {
        concurrency: manifest.executionMode === "single" ? 1 : policy.concurrency,
        prepareGroup: async (entries, signal) => {
          const results = await fileScraper.prepareGroup(
            entries.map(({ item, attemptId }) => {
              const progress = {
                fileIndex: 1,
                totalFiles: manifest.items.length,
                onProgress: (value: number) => reporter.progress(item.id, value),
              };
              return {
                filePath: item.sourcePath,
                progress,
                options: {
                  configuration,
                  ...(item.manualScrape ? { manualScrape: item.manualScrape } : {}),
                  source: item.executionSource ?? { rootId: item.rootId, relativePath: item.relativePath },
                  roots: [...roots.values()],
                  operationId: `${manifest.id}:${attemptId}`,
                  outputDirectory: item.manualScrape
                    ? resolve(outputRoot.hostPath, manifest.requestedOutputRelativeDirectory ?? "")
                    : undefined,
                  outputTemplateRoot:
                    item.outputTemplateRoot ??
                    resolve(outputRoot.hostPath, manifest.requestedOutputRelativeDirectory ?? ""),
                },
              };
            }),
            signal,
          );
          return results.map((result, index) => {
            const item = entries[index].item;
            if (result.status === "prepared") return result;
            return {
              status: result.status,
              result: { ...result, fileId: item.id, rootId: item.rootId, relativePath: item.relativePath },
            };
          });
        },
        executePreparedFiles: async (entries, signal) =>
          await fileScraper.executePreparedFiles(
            entries.map(({ item, fileScrape }) => ({
              prepared: fileScrape,
              progress: {
                fileIndex: 1,
                totalFiles: manifest.items.length,
                onProgress: (value: number) => reporter.progress(item.id, value),
              },
              caseId: item.caseId,
            })),
            signal,
          ),
      },
    });
  }

  private handleTerminalRun(manifest: ScrapeRunManifest, snapshot: ScrapeRunSnapshot<ManualScrapeOptions>): void {
    this.discoveredInventories.delete(manifest.id);
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
}
