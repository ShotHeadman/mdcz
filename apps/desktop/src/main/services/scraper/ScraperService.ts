import { ActorImageService } from "@main/services/ActorImageService";
import { type Configuration, configManager } from "@main/services/config";
import {
  createImageHostCooldownStore,
  type PersistentCooldownStore,
} from "@main/services/cooldown/PersistentCooldownStore";
import { loggerService } from "@main/services/LoggerService";
import { OutputLibraryScanner } from "@main/services/library";
import { DesktopPersistenceService } from "@main/services/persistence";
import type { SignalService } from "@main/services/SignalService";
import { didPromiseTimeout } from "@main/utils/async";
import { resolveRootRelativePath, toRootRelativePath } from "@mdcz/media-store";
import type { ScrapeRunManifest } from "@mdcz/persistence";
import type { ActorSourceProvider } from "@mdcz/runtime/actorSource";
import type { CrawlerProvider } from "@mdcz/runtime/crawler";
import {
  createDesktopInputRoot,
  createDesktopOutputRoot,
  mediaPathOwnership,
  resolveDesktopInputRootPath,
} from "@mdcz/runtime/library";
import { buildMovieTags } from "@mdcz/runtime/maintenance";
import type { NetworkClient } from "@mdcz/runtime/network";
import { commitScrapeTerminalResult } from "@mdcz/runtime/publication";
import type { ScrapeExecutionMode } from "@mdcz/runtime/scrape";
import {
  AggregationService,
  applyScrapeNetworkPolicy,
  createScrapeExecutionPolicy,
  DownloadManager,
  type FileScrapeResult,
  NfoGenerator,
  TranslateService,
} from "@mdcz/runtime/scrape";
import {
  ScrapeCoordinator,
  type ScrapeHostPort,
  type ScrapeRunItem,
  type ScrapeRunSnapshot,
  type ScrapeWorkflowReporter,
  toScrapeRunSnapshotDto,
} from "@mdcz/runtime/tasks";
import type { ScrapeRunSnapshotDto } from "@mdcz/shared/serverDtos";
import type { ScrapeResult } from "@mdcz/shared/types";
import { createFileScraper, fileOrganizer } from "./FileScraper";
import type { ManualScrapeOptions } from "./manualScrape";
import {
  resolveSelectedFilePaths as resolveSelectedFilePathsForScrape,
  resolveSingleFilePaths as resolveSingleFilePathsForScrape,
  uniquePaths,
} from "./pathResolver";
import { ScraperServiceError } from "./ScraperServiceError";
import { translationMappingStore } from "./translationMappingStore";

export interface StartScrapeResult {
  taskId: string;
  totalFiles: number;
}
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

interface DesktopScrapeStart {
  files: string[];
  mode: ScrapeExecutionMode;
  configuration: Configuration;
  concurrency?: number;
  manualScrape?: ManualScrapeOptions;
}

export class ScraperService {
  private readonly logger = loggerService.getLogger("ScraperService");
  private readonly actorImageService: ActorImageService;
  private readonly actorSourceProvider: ActorSourceProvider | undefined;
  private readonly sharedNetworkClient: NetworkClient;
  private readonly aggregationService: AggregationService;
  private readonly imageHostCooldownStore: PersistentCooldownStore;
  private readonly host: ScrapeHostPort<DesktopScrapeStart, ScrapeRunManifest, ManualScrapeOptions>;
  private workflow: ScrapeCoordinator<DesktopScrapeStart, ScrapeRunManifest, ManualScrapeOptions> | null = null;
  private closed = false;

  constructor(
    private readonly signalService: SignalService,
    networkClient: NetworkClient,
    crawlerProvider: CrawlerProvider,
    actorImageService?: ActorImageService,
    actorSourceProvider?: ActorSourceProvider,
    imageHostCooldownStore?: PersistentCooldownStore,
    private readonly outputLibraryScanner = new OutputLibraryScanner(),
    private readonly persistenceService = new DesktopPersistenceService(),
  ) {
    this.actorImageService = actorImageService ?? new ActorImageService();
    this.actorSourceProvider = actorSourceProvider;
    this.sharedNetworkClient = networkClient;
    this.aggregationService = new AggregationService(crawlerProvider, { logger: this.logger });
    this.imageHostCooldownStore = imageHostCooldownStore ?? createImageHostCooldownStore();
    this.host = {
      create: async (input) => await this.createRun(input),
      runId: (run) => run.id,
      createExecution: async (run, reporter) => await this.createExecution(run, reporter),
      onInvalidate: () => this.signalService.invalidate("scrape"),
      onTerminal: async (run, snapshot) => this.handleTerminalRun(run, snapshot),
      onError: async (runId, error) => {
        this.logger.error(`Scrape execution failed for ${runId}`, error);
      },
    };
  }

  async getSnapshot(): Promise<ScrapeRunSnapshotDto | null> {
    const live = this.workflow?.liveRuns()[0];
    return live ? this.toSnapshotDto(live.run, live.snapshot, live.startedAt) : null;
  }

  async startSingle(paths: string[]): Promise<StartScrapeResult> {
    const configuration = await configManager.getValidated();
    const files = await resolveSingleFilePathsForScrape(uniquePaths(paths));
    if (files.length === 0) throw new ScraperServiceError("NO_FILES", "No files selected");
    return await this.start({ files, mode: "single", configuration, concurrency: 1 });
  }

  async startSelectedFiles(paths: string[]): Promise<StartScrapeResult> {
    const configuration = await configManager.getValidated();
    const files = await resolveSelectedFilePathsForScrape(uniquePaths(paths));
    if (files.length === 0) throw new ScraperServiceError("NO_FILES", "No files selected");
    return await this.start({ files, mode: "batch", configuration });
  }

  async stop(): Promise<{ pendingCount: number }> {
    const live = this.workflow?.liveRuns()[0];
    if (!live) return { pendingCount: 0 };
    const pendingCount = live.snapshot.items.filter(
      (item) => !["success", "failed", "skipped"].includes(item.status),
    ).length;
    this.signalService.setButtonStatus(false, false);
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

  async retry(runId: string): Promise<StartScrapeResult> {
    if (!runId.trim()) throw new ScraperServiceError("NO_FILES", "No scrape run selected for retry");
    const configuration = await configManager.getValidated();
    this.clearImageHostCooldownsForRetry();
    this.configureRuntimeSettings(configuration);
    const snapshot = await (await this.coordinator()).retry(runId);
    this.signalService.setButtonStatus(false, true);
    this.signalService.resetProgress();
    return { taskId: snapshot.runId, totalFiles: snapshot.items.length };
  }

  private async start(input: DesktopScrapeStart): Promise<StartScrapeResult> {
    this.configureRuntimeSettings(input.configuration);
    const snapshot = await (await this.coordinator()).start(input);
    this.signalService.setButtonStatus(false, true);
    this.signalService.resetProgress();
    return { taskId: snapshot.runId, totalFiles: snapshot.items.length };
  }

  private async coordinator(): Promise<ScrapeCoordinator<DesktopScrapeStart, ScrapeRunManifest, ManualScrapeOptions>> {
    if (this.closed) throw new Error("Scrape queue is closing");
    if (this.workflow) return this.workflow;
    const state = await this.persistenceService.initialize();
    this.workflow = new ScrapeCoordinator(state.repositories.scrapeRuns, this.host);
    return this.workflow;
  }

  private createFileScraperDependencies(recordProgress: (value: number, current: number, total: number) => void) {
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
          this.signalService.setProgress(value, current, total);
        },
        showFailedInfo: this.signalService.showFailedInfo.bind(this.signalService),
        showLogText: this.signalService.showLogText.bind(this.signalService),
        showScrapeInfo: this.signalService.showScrapeInfo.bind(this.signalService),
        showScrapeResult: this.signalService.showScrapeResult.bind(this.signalService),
      },
      actorImageService: this.actorImageService,
      actorSourceProvider: this.actorSourceProvider,
    };
  }

  private configureRuntimeSettings(configuration: Configuration): void {
    applyScrapeNetworkPolicy(this.sharedNetworkClient, configuration);
  }

  private async createRun(input: DesktopScrapeStart): Promise<ScrapeRunManifest> {
    const state = await this.persistenceService.getState();
    const startedAt = new Date();
    const configuredMediaPath = input.configuration.paths.mediaPath.trim();
    const inputRoot = createDesktopInputRoot(
      resolveDesktopInputRootPath(input.files, configuredMediaPath || undefined),
      startedAt,
    );
    const outputRoot = createDesktopOutputRoot(input.configuration, startedAt);
    const metadataRoot = input.configuration.paths.metadataPath.trim()
      ? createDesktopInputRoot(input.configuration.paths.metadataPath, startedAt)
      : null;
    for (const root of [inputRoot, outputRoot, metadataRoot].filter((root) => root !== null)) {
      await state.repositories.mediaRoots.upsert(root);
    }
    return await state.repositories.scrapeRuns.create({
      rootId: inputRoot.id,
      outputRootId: outputRoot?.id ?? null,
      executionMode: input.mode,
      items: input.files.map((sourcePath, ordinal) => ({
        ordinal,
        rootId: inputRoot.id,
        relativePath: toRootRelativePath(inputRoot, sourcePath),
      })),
    });
  }

  private async createExecution(manifest: ScrapeRunManifest, reporter: ScrapeWorkflowReporter) {
    const configuration = await configManager.getValidated();
    this.configureRuntimeSettings(configuration);
    const policy = createScrapeExecutionPolicy(configuration, { logger: this.logger });
    const state = await this.persistenceService.getState();
    const root = await state.repositories.mediaRoots.get(manifest.rootId, { includeDeleted: true });
    const roots = await state.repositories.mediaRoots.list({ includeDeleted: true });
    const settledAttemptIds = new Set(manifest.outcomes.map((outcome) => outcome.attemptId));
    const openAttemptByItemId = new Map(
      manifest.attempts
        .filter((attempt) => !settledAttemptIds.has(attempt.id))
        .map((attempt) => [attempt.itemId, attempt.id]),
    );
    const records =
      openAttemptByItemId.size > 0 ? manifest.items.filter((item) => openAttemptByItemId.has(item.id)) : manifest.items;
    const items: ScrapeRunItem<ManualScrapeOptions>[] = records.map((item) => ({
      id: item.id,
      rootId: item.rootId,
      relativePath: item.relativePath,
      sourcePath: resolveRootRelativePath(root, item.relativePath),
    }));
    const itemIndexById = new Map(items.map((item, index) => [item.id, index + 1]));
    const fileScraper = createFileScraper(
      this.createFileScraperDependencies((value, current, total) => {
        const item = items[current - 1];
        if (item) reporter.progress(item.id, value * total - (current - 1) * 100);
      }),
      { mode: manifest.executionMode, scrapeSessionId: manifest.id },
    );
    return {
      items,
      concurrency: manifest.executionMode === "single" ? 1 : policy.concurrency,
      admitItem: async (item: ScrapeRunItem<ManualScrapeOptions>) => {
        const existing = openAttemptByItemId.get(item.id);
        if (existing) return existing;
        const attempt = state.repositories.scrapeRuns.admitAttempt(item.id);
        openAttemptByItemId.set(item.id, attempt.id);
        return attempt.id;
      },
      acquireItem: (item: ScrapeRunItem<ManualScrapeOptions>) =>
        mediaPathOwnership.acquire(item.rootId, item.relativePath, item.id),
      executeItem: async (item: ScrapeRunItem<ManualScrapeOptions>, signal: AbortSignal, attemptId: string) => {
        await policy.restGate?.waitBeforeStart(signal);
        const progress = { fileIndex: itemIndexById.get(item.id) ?? 1, totalFiles: items.length };
        return await fileScraper.scrapeFile(item.sourcePath, progress, signal, {
          ...(item.manualScrape ? { manualScrape: item.manualScrape } : {}),
          source: { rootId: item.rootId, relativePath: item.relativePath },
          roots,
          operationId: `${manifest.id}:${attemptId}`,
        });
      },
      commitItem: async (item: ScrapeRunItem<ManualScrapeOptions>, result: ScrapeResult, attemptId: string) =>
        await this.commitItem(item, result, attemptId),
    };
  }

  private async commitItem(item: ScrapeRunItem, result: ScrapeResult, attemptId: string): Promise<ScrapeResult> {
    const state = await this.persistenceService.getState();
    const plan = (result as FileScrapeResult).publicationPlan;
    return await commitScrapeTerminalResult({
      result,
      attemptId,
      itemPath: item.relativePath,
      success:
        result.status === "success" && plan
          ? {
              plan,
              crawlerData: result.crawlerData,
              identity: result.crawlerData?.number || result.fileName,
              nfo: result.nfo ?? null,
              size: plan.video?.size ?? 0,
              modifiedAt: null,
              uncensoredAmbiguous: result.uncensoredAmbiguous === true,
            }
          : undefined,
      scrapeRuns: state.repositories.scrapeRuns,
      resolveRoot: async (rootId) => await state.repositories.mediaRoots.get(rootId),
      acquireAll: (refs) => mediaPathOwnership.acquireAll(refs, item.id),
      journal: state.repositories.publicationJournal,
      repairIssues: state.repositories.libraryRepairIssues,
    });
  }

  private handleTerminalRun(_manifest: ScrapeRunManifest, snapshot: ScrapeRunSnapshot<ManualScrapeOptions>): void {
    this.logger.info(`Scrape run finished: ${snapshot.runId}`);
    this.outputLibraryScanner.invalidate();
    this.aggregationService.clearCache();
    this.signalService.setButtonStatus(true, false);
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
