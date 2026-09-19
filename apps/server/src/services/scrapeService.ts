import { randomUUID } from "node:crypto";
import type { ActorSourceProvider } from "@mdcz/runtime/actorSource";
import type { CrawlerProvider } from "@mdcz/runtime/crawler";
import type { NetworkClient } from "@mdcz/runtime/network";
import {
  type ActorImageService,
  type AggregationService,
  applyPosterTagBadgesIfNeeded,
  type ImageHostCooldownStore,
  NfoGenerator,
  PosterCropService,
  PosterWatermarkService,
  ScrapeRunner,
} from "@mdcz/runtime/scrape";
import { runtimeLoggerService } from "@mdcz/runtime/shared";
import type { TranslationMappingStore } from "@mdcz/runtime/translate";
import { toErrorMessage } from "@mdcz/shared/error";
import type {
  FileActionInput,
  FileActionResponse,
  NfoReadInput,
  NfoReadResponse,
  NfoWriteInput,
  NfoWriteResponse,
  PosterCropSaveInput,
  PosterCropSessionResponse,
  ScrapeConfirmUncensoredInput,
  ScrapeHistoryResponse,
  ScrapeLiveRunsResponse,
  ScrapePendingUncensoredConfirmationResponse,
  ScrapeRerunDirectoryInput,
  ScrapeResultDetailResponse,
  ScrapeRunSnapshotDto,
  ScrapeStartInput,
  ScrapeTaskControlInput,
  TaskEventDto,
} from "@mdcz/shared/serverDtos";
import type { TaskEventBus } from "../taskEvents";
import type { ServerConfigService } from "./configService";
import type { MediaRootService } from "./mediaRootService";
import type { ServerPersistenceService } from "./persistenceService";
import { decorateTaskLog } from "./runtimeLogService";
import { ServerNfoAdapter, ServerPosterCropAdapter, type ServerScrapeArtifactRecord } from "./scrapeAdapters";

export interface ScrapeServiceResources {
  networkClient: NetworkClient;
  crawlerProvider: CrawlerProvider;
  imageHostCooldownStore: ImageHostCooldownStore & { clear?: () => void; flush?: () => Promise<void> };
  actorImageService: ActorImageService;
  actorSourceProvider?: ActorSourceProvider;
  mappingStore?: TranslationMappingStore;
  aggregationService?: Pick<AggregationService, "aggregate"> & {
    clearCache?: () => void;
    getFailureSummary?: (number: string) => string | undefined;
  };
  prepareScrapeItem?: <T extends { relativePath: string; caseId?: string }>(item: T) => T;
}

export class ScrapeService {
  private readonly nfoAdapter: ServerNfoAdapter;
  private readonly posterCropAdapter: ServerPosterCropAdapter;
  private readonly networkClient: NetworkClient;
  private readonly crawlerProvider: CrawlerProvider;
  private readonly imageHostCooldownStore: ImageHostCooldownStore & { clear?: () => void; flush?: () => Promise<void> };
  private readonly actorImageService: ActorImageService;
  private readonly actorSourceProvider?: ActorSourceProvider;
  private readonly mappingStore?: TranslationMappingStore;
  private readonly aggregationService?: ScrapeServiceResources["aggregationService"];
  private readonly prepareScrapeItem: <T extends { relativePath: string; caseId?: string }>(item: T) => T;
  private posterWatermarkService: PosterWatermarkService | null = null;
  private runnerInstance: ScrapeRunner | null = null;
  private scrapeInvalidationTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private readonly persistence: ServerPersistenceService,
    private readonly mediaRoots: MediaRootService,
    private readonly config: ServerConfigService,
    private readonly taskEvents: TaskEventBus,
    resources: ScrapeServiceResources,
  ) {
    this.networkClient = resources.networkClient;
    this.crawlerProvider = resources.crawlerProvider;
    this.imageHostCooldownStore = resources.imageHostCooldownStore;
    this.actorImageService = resources.actorImageService;
    this.actorSourceProvider = resources.actorSourceProvider;
    this.mappingStore = resources.mappingStore;
    this.aggregationService = resources.aggregationService;
    this.prepareScrapeItem = resources.prepareScrapeItem ?? ((item) => item);
    this.nfoAdapter = new ServerNfoAdapter(this.mediaRoots, this.config, new NfoGenerator(), this.persistence);
    this.posterCropAdapter = new ServerPosterCropAdapter(
      this.mediaRoots,
      this.config,
      new PosterCropService(),
      this.persistence,
    );
  }

  private async runner(): Promise<ScrapeRunner> {
    if (this.closed) throw new Error("Scrape queue is closing");
    if (this.runnerInstance) return this.runnerInstance;
    const state = await this.persistence.initialize();
    this.posterWatermarkService ??= new PosterWatermarkService({ dataDir: this.config.runtimePaths.dataDir });
    const posterWatermarkService = this.posterWatermarkService;
    this.runnerInstance = new ScrapeRunner({
      persistence: {
        scrapeRuns: state.repositories.scrapeRuns,
        library: state.repositories.library,
        publicationJournal: state.repositories.publicationJournal,
        mediaRoots: this.mediaRoots,
      },
      getConfiguration: async () => await this.config.get(),
      networkClient: this.networkClient,
      crawlerProvider: this.crawlerProvider,
      imageHostCooldownStore: this.imageHostCooldownStore,
      actorImageService: this.actorImageService,
      actorSourceProvider: this.actorSourceProvider,
      mappingStore: this.mappingStore,
      aggregationService: this.aggregationService,
      prepareScrapeItem: this.prepareScrapeItem,
      postProcessAssets: async ({ assets, configuration, crawlerData, fileInfo, localState, signal, signalService }) =>
        await applyPosterTagBadgesIfNeeded({
          assets,
          config: configuration,
          crawlerData,
          dataDir: this.config.runtimePaths.dataDir,
          fileInfo,
          localState,
          logger: runtimeLoggerService.getLogger("ScrapeRunner"),
          signal,
          signalService,
          watermarkService: posterWatermarkService,
        }),
      platform: "server",
      logger: runtimeLoggerService.getLogger("ScrapeRunner"),
      onCommitted: (runId, result) => {
        this.addEvent(
          runId,
          result.status === "success" ? "item-success" : result.status === "skipped" ? "item-skipped" : "item-failed",
          result.status === "success"
            ? `Generated NFO: ${result.nfo?.relativePath ?? "not generated"}`
            : result.error
              ? `${result.relativePath}: ${result.error}`
              : result.relativePath,
          result.fileId,
        );
      },
      onInvalidate: () => {
        this.scheduleScrapeInvalidation();
      },
      onTerminal: async (run, snapshot) => {
        const summary = (await this.persistence.getState()).repositories.scrapeRuns.summary(run);
        const terminalStatus = summary?.disposition ?? snapshot.task.status;
        this.addEvent(
          run.id,
          terminalStatus,
          terminalStatus === "completed"
            ? `Scrape completed. Succeeded: ${summary?.successCount ?? 0}, Failed: ${summary?.failedCount ?? 0}`
            : `Scrape failed. Succeeded: ${summary?.successCount ?? 0}, Failed: ${summary?.failedCount ?? 0}, Skipped: ${summary?.skippedCount ?? 0}`,
        );
        this.taskEvents.lifecycle({
          id: run.id,
          kind: "scrape",
          rootId: run.rootId,
          rootDisplayName: snapshot.task.rootDisplayName,
          status: terminalStatus,
          startedAt: snapshot.task.startedAt,
          completedAt: snapshot.task.completedAt,
          error: snapshot.task.error,
        });
        this.taskEvents.invalidate("scrape-history", "pending-confirmation");
      },
      onError: async (runId, error) => {
        runtimeLoggerService.getLogger(`scrape:${runId}`).error(`Scrape execution failed: ${toErrorMessage(error)}`);
      },
    });
    return this.runnerInstance;
  }

  async start(input: ScrapeStartInput): Promise<ScrapeRunSnapshotDto> {
    const runner = await this.runner();
    const result = await runner.start(input);
    this.addEvent(result.taskId, "queued", "Scrape task queued");
    return result.snapshot;
  }

  async liveRuns(): Promise<ScrapeLiveRunsResponse> {
    return await (await this.runner()).liveRuns();
  }

  async pendingUncensoredConfirmation(): Promise<ScrapePendingUncensoredConfirmationResponse> {
    return await (await this.runner()).pendingUncensoredConfirmation();
  }

  async history(input?: ScrapeTaskControlInput): Promise<ScrapeHistoryResponse> {
    return await (await this.runner()).history(input);
  }

  async snapshot(input: ScrapeTaskControlInput): Promise<ScrapeRunSnapshotDto> {
    const snapshot = await (await this.runner()).getSnapshot(input.taskId);
    if (!snapshot) throw new Error(`Scrape task not found: ${input.taskId}`);
    return snapshot;
  }

  async result(id: string): Promise<ScrapeResultDetailResponse> {
    return await (await this.runner()).result(id);
  }

  async stop(input: ScrapeTaskControlInput): Promise<string> {
    await (await this.runner()).stop(input.taskId);
    return input.taskId;
  }

  async pause(input: ScrapeTaskControlInput): Promise<string> {
    await (await this.runner()).pause(input.taskId);
    this.addEvent(input.taskId, "paused", "Scrape task paused");
    return input.taskId;
  }

  async resume(input: ScrapeTaskControlInput): Promise<string> {
    await (await this.runner()).resume(input.taskId);
    this.addEvent(input.taskId, "queued", "Scrape task queued");
    return input.taskId;
  }

  async retry(input: ScrapeTaskControlInput): Promise<ScrapeRunSnapshotDto> {
    const runner = await this.runner();
    const result = await runner.retry(input.taskId, input.itemIds);
    this.addEvent(result.taskId, "queued", "Scrape retry queued");
    return result.snapshot;
  }

  async rerunDirectory(input: ScrapeRerunDirectoryInput): Promise<ScrapeRunSnapshotDto> {
    const runner = await this.runner();
    const result = await runner.rerunDirectory(input.taskId);
    this.addEvent(result.taskId, "queued", "Directory rescan queued");
    return result.snapshot;
  }

  async confirmUncensored(input: ScrapeConfirmUncensoredInput): Promise<string> {
    await (await this.runner()).confirmUncensored(input);
    this.taskEvents.invalidate("scrape-history", "pending-confirmation");
    return input.taskId;
  }

  async nfoRead(input: NfoReadInput): Promise<NfoReadResponse> {
    return await this.nfoAdapter.read(input);
  }

  async nfoWrite(input: NfoWriteInput): Promise<NfoWriteResponse> {
    return await this.nfoAdapter.write(input);
  }

  async posterCropSession(id: string): Promise<PosterCropSessionResponse> {
    const record = await this.toArtifactRecord(id);
    return await this.posterCropAdapter.session(record);
  }

  async posterCropSave(input: PosterCropSaveInput): Promise<PosterCropSessionResponse> {
    const record = await this.toArtifactRecord(input.id);
    return await this.posterCropAdapter.save(record, input);
  }

  async removeRecord(input: FileActionInput): Promise<FileActionResponse> {
    const [target] = await this.mediaRoots.canonicalizeFileRefs([input]);
    if (!target) throw new Error("File ref is required");
    const state = await this.persistence.getState();
    const entry = await state.repositories.library.getEntry(target.rootId, target.relativePath);
    const file = entry.files.find(
      (candidate) => candidate.rootId === target.rootId && candidate.rootRelativePath === target.relativePath,
    );
    if (!file) throw new Error("Library file not found");
    state.repositories.library.removeFile(file.id);
    this.taskEvents.invalidate("scrape-history", "pending-confirmation");
    return { ok: true, ...target };
  }

  async close(): Promise<void> {
    if (this.scrapeInvalidationTimer) {
      clearTimeout(this.scrapeInvalidationTimer);
      this.scrapeInvalidationTimer = null;
    }
    this.closed = true;
    await this.runnerInstance?.shutdown();
  }

  private async toArtifactRecord(itemId: string): Promise<ServerScrapeArtifactRecord> {
    const state = await this.persistence.getState();
    const item = await state.repositories.scrapeRuns.getItem(itemId);
    if (item.status !== "success") {
      throw new Error("Poster editing requires a successful scrape outcome with local output");
    }
    const entry = item.libraryFileId
      ? await state.repositories.library.getEntryByFileId(item.libraryFileId).catch(() => null)
      : null;
    const file = entry?.files.find((candidate) => candidate.id === item.libraryFileId);
    const nfoAsset = entry?.assets.find((asset) => asset.kind === "nfo");
    if (!file?.rootRelativePath) {
      throw new Error("Poster editing requires a successful scrape outcome with local output");
    }
    return {
      rootId: item.rootId,
      relativePath: item.relativePath,
      nfoRootId: nfoAsset?.rootId ?? null,
      outputRootId: file.rootId,
      outputRelativePath: file.rootRelativePath,
    };
  }

  private addEvent(runId: string, type: string, message: string, itemId?: string): TaskEventDto {
    const createdAt = new Date();
    const event: TaskEventDto = {
      id: randomUUID(),
      taskId: runId,
      type,
      message,
      createdAt: createdAt.toISOString(),
    };
    if (this.runnerInstance) {
      this.runnerInstance.recordLog(runId, {
        level: type.includes("failed") ? "error" : "info",
        message,
        itemId: itemId ?? null,
        timestamp: createdAt,
      });
    }
    this.taskEvents.log(decorateTaskLog(event));
    return event;
  }

  private scheduleScrapeInvalidation(): void {
    if (this.scrapeInvalidationTimer) return;
    this.scrapeInvalidationTimer = setTimeout(() => {
      this.scrapeInvalidationTimer = null;
      this.taskEvents.invalidate("scrape-live");
    }, 250);
  }
}
