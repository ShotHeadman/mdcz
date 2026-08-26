import { randomUUID } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { type MediaRoot, resolveRootRelativePath, toRootRelativePath } from "@mdcz/media-store";
import type {
  LibraryEntryRecord,
  ScrapeItemOutcomeRecord,
  ScrapeRunItemRecord,
  ScrapeRunManifest,
} from "@mdcz/persistence";
import { toLibraryAssets } from "@mdcz/runtime/library";
import { buildMovieTags, LocalScanService } from "@mdcz/runtime/maintenance";
import { MaintenanceArtifactResolver } from "@mdcz/runtime/maintenance/MaintenanceArtifactResolver";
import { NetworkClient } from "@mdcz/runtime/network";
import {
  applyScrapeNetworkPolicy,
  confirmUncensoredOutputs,
  createScrapeExecutionPolicy,
  FileOrganizer,
  formatDiskCommitFailure,
  type MountedRootScrapeRuntime,
  type MountedRootScrapeRuntimeItemSuccess,
  NfoGenerator,
  PosterCropService,
} from "@mdcz/runtime/scrape";
import { runtimeLoggerService } from "@mdcz/runtime/shared";
import {
  type ScrapeRunItem,
  type ScrapeRunItemSnapshot,
  ScrapeRunSession,
  type ScrapeRunSnapshot,
  TaskScheduler,
} from "@mdcz/runtime/tasks";
import type { TranslationMappingStore } from "@mdcz/runtime/translate";
import { scrapeAssetReferencesToResult } from "@mdcz/shared/dtoAdapters";
import { validateManualScrapeUrl } from "@mdcz/shared/manualScrapeUrl";
import {
  type AmbiguousUncensoredItemDto,
  crawlerDataSchema,
  type FileActionInput,
  type FileActionResponse,
  type LogEntryDto,
  type NfoReadInput,
  type NfoReadResponse,
  type NfoWriteInput,
  type NfoWriteResponse,
  type PosterCropSaveInput,
  type PosterCropSessionResponse,
  type ScanTaskDto,
  type ScrapeConfirmUncensoredInput,
  type ScrapeHistoryResponse,
  type ScrapeHistoryRunDto,
  type ScrapeLiveItemDto,
  type ScrapeLiveRunSnapshotDto,
  type ScrapeLiveRunsResponse,
  type ScrapePendingUncensoredConfirmationResponse,
  type ScrapeResultDetailResponse,
  type ScrapeResultDto,
  type ScrapeStartInput,
  type ScrapeStartSelectedFilesInput,
  type ScrapeTaskControlInput,
  type TaskEventDto,
} from "@mdcz/shared/serverDtos";
import type { ScrapeResult, UncensoredChoice } from "@mdcz/shared/types";
import { getServerImageHostCooldownStore } from "../imageHostCooldownStore";
import { toRootRelativeAssetPath, toScrapeAssetDto, toScrapeResultDto } from "../scrapeDtos";
import { createServerScrapeRuntime } from "../scrapeRuntimeFactory";
import { toScanTaskDto } from "../taskDto";
import type { TaskEventBus } from "../taskEvents";
import type { ServerConfigService } from "./configService";
import type { MediaRootService } from "./mediaRootService";
import type { ServerPersistenceService } from "./persistenceService";
import { decorateTaskLog } from "./runtimeLogService";
import { ServerNfoAdapter, ServerPosterCropAdapter, type ServerScrapeArtifactRecord } from "./scrapeAdapters";

export const SCRAPE_BACKEND_INTERRUPTED_MESSAGE = "刮削后端已重启，任务已中断；请重新扫描磁盘并基于当前文件创建新任务";
const INTERRUPTED_RETRY_MESSAGE = "中断任务必须先重新扫描磁盘，再从当前文件列表创建新任务";
const STOPPED_MESSAGE = "刮削已停止";

type ServerManualScrape = {
  manualUrl: string | null;
  uncensoredChoice: UncensoredChoice | null;
};

type LiveQueueEntry = {
  id: string;
  runId: string;
  manifest: ScrapeRunManifest;
  session: ScrapeRunSession<ServerManualScrape>;
  status: "queued" | "running" | "paused" | "stopping";
  createdAt: Date;
  startedAt: Date | null;
  settlement: Promise<void> | null;
  rootDisplayName: string;
};

type PendingSuccess = {
  root: MediaRoot;
  runtimeResult: MountedRootScrapeRuntimeItemSuccess;
};

type OutcomeContext = {
  manifest: ScrapeRunManifest;
  item: ScrapeRunItemRecord;
  outcome: ScrapeItemOutcomeRecord;
};

const outcomeKey = (runId: string, itemId: string, attempt: number): string =>
  `${runId}\u0000${itemId}\u0000${attempt}`;

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const createFailedResult = (
  item: ScrapeRunItem<ServerManualScrape>,
  error: string,
  status: "failed" | "skipped" = "failed",
): ScrapeResult => ({
  fileId: item.id,
  fileInfo: {
    filePath: item.sourcePath,
    fileName: path.basename(item.sourcePath),
    extension: path.extname(item.sourcePath),
    number: path.basename(item.sourcePath, path.extname(item.sourcePath)),
    isSubtitled: false,
  },
  status,
  error,
});

export class ScrapeService {
  private readonly pendingSuccesses = new Map<string, PendingSuccess>();
  private readonly networkClient = new NetworkClient();
  private readonly fileOrganizer = new FileOrganizer();
  private readonly nfoGenerator = new NfoGenerator();
  private readonly posterCropService = new PosterCropService();
  private readonly nfoAdapter: ServerNfoAdapter;
  private readonly posterCropAdapter: ServerPosterCropAdapter;
  private readonly runtime: MountedRootScrapeRuntime;
  private readonly runs = new Map<string, LiveQueueEntry>();
  private readonly readyRunIds: string[] = [];
  private readonly scheduler: TaskScheduler<LiveQueueEntry>;
  private activeRunId: string | null = null;
  private closing = false;
  private scrapeInvalidationTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly persistence: ServerPersistenceService,
    private readonly mediaRoots: MediaRootService,
    private readonly config: ServerConfigService,
    private readonly taskEvents: TaskEventBus,
    runtime?: MountedRootScrapeRuntime,
    mappingStore?: TranslationMappingStore,
  ) {
    this.nfoAdapter = new ServerNfoAdapter(this.mediaRoots, this.config, this.nfoGenerator);
    this.posterCropAdapter = new ServerPosterCropAdapter(
      this.mediaRoots,
      this.config,
      this.posterCropService,
      (result) => this.resolveMetadataVideoPath(result),
    );
    this.runtime = runtime ?? createServerScrapeRuntime(this.config, this.networkClient, mappingStore);
    this.scheduler = new TaskScheduler({
      claimNext: async () => this.claimNext(),
      runExecution: async (entry) => this.runEntry(entry),
      onExecutionError: async (entry, error) => {
        runtimeLoggerService
          .getLogger(`scrape:${entry.runId}`)
          .error(`Scrape execution failed: ${errorMessage(error)}`);
        await this.stopEntry(entry);
      },
    });
  }

  async start(
    input: ScrapeStartInput,
    options?: { uncensoredChoices?: Map<string, UncensoredChoice> },
  ): Promise<ScrapeLiveRunSnapshotDto> {
    if (this.closing) throw new Error("Scrape queue is closing");
    const roots = new Map<string, MediaRoot>();
    for (const ref of input.refs) {
      if (!roots.has(ref.rootId)) roots.set(ref.rootId, await this.mediaRoots.getActiveRoot(ref.rootId));
    }
    if (input.outputRootId) await this.mediaRoots.getActiveRoot(input.outputRootId);

    const choices =
      options?.uncensoredChoices ??
      new Map(input.refs.map((ref) => [`${ref.rootId}:${ref.relativePath}`, "uncensored" as const]));
    const configuration = await this.config.get();
    applyScrapeNetworkPolicy(this.networkClient, configuration);
    const policy = createScrapeExecutionPolicy(configuration, { logger: console });
    const manifest = await (await this.persistence.getState()).repositories.scrapeRuns.create({
      rootId: input.refs[0]?.rootId ?? "",
      outputRootId: input.outputRootId ?? null,
      executionMode: input.refs.length === 1 ? "single" : "batch",
      items: input.refs.map((ref, ordinal) => ({
        ordinal,
        rootId: ref.rootId,
        relativePath: ref.relativePath,
        manualUrl: input.manualUrl ?? null,
        uncensoredChoice: input.uncensoredConfirmed ? (choices.get(`${ref.rootId}:${ref.relativePath}`) ?? null) : null,
      })),
    });
    const items = manifest.items.map((item) => {
      const root = roots.get(item.rootId);
      if (!root) throw new Error(`Scrape root disappeared before session creation: ${item.rootId}`);
      return {
        id: item.id,
        rootId: item.rootId,
        relativePath: item.relativePath,
        sourcePath: resolveRootRelativePath(root, item.relativePath),
        attempt: 1,
        manualScrape: { manualUrl: item.manualUrl, uncensoredChoice: item.uncensoredChoice },
      };
    });
    const session = new ScrapeRunSession<ServerManualScrape>({
      runId: manifest.id,
      items,
      concurrency: policy.concurrency,
      executeItem: async (item, signal) => await this.executeItem(manifest, item, signal, policy.restGate ?? undefined),
      commitItem: async (item, result) => await this.commitItem(manifest, item, result),
      onSnapshot: () => this.handleSessionSnapshot(),
    });
    const entry: LiveQueueEntry = {
      id: manifest.id,
      runId: manifest.id,
      manifest,
      session,
      status: "queued",
      createdAt: manifest.createdAt,
      startedAt: null,
      settlement: null,
      rootDisplayName: roots.get(manifest.rootId)?.displayName ?? "未知媒体目录",
    };
    this.runs.set(manifest.id, entry);
    this.readyRunIds.push(manifest.id);
    this.addEvent(manifest.id, "queued", "Scrape task queued");
    this.scheduleScrapeInvalidation();
    this.scheduler.drain();
    return await this.liveRunSnapshotDto(manifest, entry, session.snapshot());
  }

  async startSelectedFiles(input: ScrapeStartSelectedFilesInput): Promise<ScrapeLiveRunSnapshotDto> {
    if (!input.scanDir) throw new Error("scanDir is required when starting selected host files");
    const normalizedScanDir = path.resolve(input.scanDir);
    const configuredMediaPath = (await this.config.get()).paths.mediaPath.trim();
    if (!configuredMediaPath) throw new Error("媒体目录未配置");
    const configuredRoot = await this.mediaRoots.setPrimaryMediaRoot({
      displayName: path.basename(path.resolve(configuredMediaPath)) || path.resolve(configuredMediaPath),
      hostPath: configuredMediaPath,
      enabled: true,
    });
    const refs: ScrapeStartInput["refs"] = [];
    for (const filePath of input.filePaths) {
      const resolvedPath = path.resolve(filePath);
      const relativeToScan = path.relative(normalizedScanDir, resolvedPath);
      if (!relativeToScan || relativeToScan.startsWith("..") || path.isAbsolute(relativeToScan)) {
        throw new Error(`文件不在扫描目录内：${filePath}`);
      }
      const relativeToRoot = path.relative(configuredRoot.hostPath, resolvedPath);
      if (!relativeToRoot || relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
        throw new Error(`文件不在已注册媒体目录内：${filePath}`);
      }
      refs.push({ rootId: configuredRoot.id, relativePath: relativeToRoot.replace(/\\/gu, "/") });
    }
    return await this.start({
      refs,
      manualUrl: input.manualUrl,
      uncensoredConfirmed: input.uncensoredConfirmed,
    });
  }

  /**
   * The only live scrape read model.  It intentionally reads only the
   * currently running process queue; durable manifests and outcomes remain
   * available through the history endpoints instead.
   */
  async liveRuns(): Promise<ScrapeLiveRunsResponse> {
    const entries = this.liveEntries();
    const runs: ScrapeLiveRunSnapshotDto[] = [];
    for (const entry of entries) {
      // Settlement removes the manifest before the queue entry is finally
      // unlinked.  Treat that narrow hand-off as already non-live instead of
      // turning an otherwise valid authority read into a 500 response.
      runs.push(await this.liveRunSnapshotDto(entry.manifest, entry, entry.session.snapshot()));
    }
    return { runs };
  }

  /**
   * Uncensored confirmation is durable post-processing, not live-session
   * recovery.  Terminal outcomes remain queryable after a backend restart.
   */
  async pendingUncensoredConfirmation(): Promise<ScrapePendingUncensoredConfirmationResponse> {
    const repository = (await this.persistence.getState()).repositories.scrapeRuns;
    const manifests = await repository.list();
    const items = (
      await Promise.all(
        manifests.map(async (manifest) =>
          (await this.buildAmbiguousUncensoredItems(manifest.id)).map((item) => ({ ...item, taskId: manifest.id })),
        ),
      )
    ).flat();
    return { items };
  }

  async history(input?: ScrapeTaskControlInput): Promise<ScrapeHistoryResponse> {
    const state = await this.persistence.getState();
    const manifests = input?.taskId
      ? [await state.repositories.scrapeRuns.get(input.taskId)]
      : await state.repositories.scrapeRuns.list();
    const runs: ScrapeHistoryRunDto[] = [];
    const results: ScrapeResultDto[] = [];
    for (const manifest of manifests) {
      runs.push(await this.historyRunDto(manifest));
      const itemById = new Map(manifest.items.map((item) => [item.id, item]));
      for (const outcome of state.repositories.scrapeRuns.latestOutcomes(manifest)) {
        const item = itemById.get(outcome.itemId);
        if (!item) throw new Error(`Scrape outcome item is missing from manifest: ${outcome.itemId}`);
        results.push(await this.outcomeToDto({ manifest, item, outcome }));
      }
    }
    return { runs, results };
  }

  async result(id: string): Promise<ScrapeResultDetailResponse> {
    return { result: await this.outcomeToDto(await this.loadOutcomeContext(id)) };
  }

  async stop(input: ScrapeTaskControlInput): Promise<string> {
    await this.stopEntry(this.requireLive(input.taskId));
    return input.taskId;
  }

  async pause(input: ScrapeTaskControlInput): Promise<string> {
    const entry = this.requireLive(input.taskId);
    if (entry.status !== "queued" && entry.status !== "running") {
      throw new Error(`Cannot pause scrape run in ${entry.status} state: ${entry.runId}`);
    }
    entry.status = "paused";
    this.removeReadyRun(entry.runId);
    await entry.session.pause();
    this.addEvent(entry.runId, "paused", "Scrape task paused");
    this.scheduleScrapeInvalidation();
    return input.taskId;
  }

  async resume(input: ScrapeTaskControlInput): Promise<string> {
    const entry = this.requireLive(input.taskId);
    if (entry.status !== "paused") throw new Error(`Cannot resume scrape run in ${entry.status} state: ${entry.runId}`);
    if (this.closing) throw new Error("Scrape queue is closing");
    entry.status = "queued";
    this.readyRunIds.push(entry.runId);
    this.addEvent(entry.runId, "queued", "Scrape task queued");
    this.scheduleScrapeInvalidation();
    this.scheduler.drain();
    return input.taskId;
  }

  async retry(input: ScrapeTaskControlInput): Promise<ScrapeLiveRunSnapshotDto> {
    const state = await this.persistence.getState();
    const manifest = await state.repositories.scrapeRuns.get(input.taskId);
    const summary = state.repositories.scrapeRuns.summary(manifest);
    if (!summary) throw new Error(INTERRUPTED_RETRY_MESSAGE);
    const retryItemIds = new Set(
      state.repositories.scrapeRuns
        .latestOutcomes(manifest)
        .filter((outcome) => outcome.outcome === "failed" || outcome.outcome === "skipped")
        .map((outcome) => outcome.itemId),
    );
    const retryItems = manifest.items.filter((item) => retryItemIds.has(item.id));
    if (retryItems.length === 0) throw new Error("当前任务没有可重试的失败或跳过项目");
    getServerImageHostCooldownStore(this.config).clear();
    runtimeLoggerService.getLogger("ScrapeService").info("Cleared image host cooldowns for user-initiated retry");
    const choices = new Map(
      retryItems
        .filter((item) => item.uncensoredChoice)
        .map((item) => [`${item.rootId}:${item.relativePath}`, item.uncensoredChoice as UncensoredChoice]),
    );
    return await this.start(
      {
        refs: retryItems.map((item) => ({ rootId: item.rootId, relativePath: item.relativePath })),
        outputRootId: manifest.requestedOutputRootId ?? undefined,
        manualUrl: retryItems.every((item) => item.manualUrl === retryItems[0]?.manualUrl)
          ? (retryItems[0]?.manualUrl ?? undefined)
          : undefined,
        uncensoredConfirmed: choices.size > 0,
      },
      { uncensoredChoices: choices },
    );
  }

  async confirmUncensored(input: ScrapeConfirmUncensoredInput): Promise<string> {
    const state = await this.persistence.getState();
    const manifest = await state.repositories.scrapeRuns.get(input.taskId);
    const summary = state.repositories.scrapeRuns.summary(manifest);
    if (!summary) throw new Error("无码确认只允许修改已结束刮削的成功结果");
    const outcomes = state.repositories.scrapeRuns.latestOutcomes(manifest);
    const outcomeByItem = new Map(outcomes.map((outcome) => [outcome.itemId, outcome]));
    const itemByRef = new Map(manifest.items.map((item) => [`${item.rootId}:${item.relativePath}`, item]));
    const selectedItems = input.items ?? input.refs?.map((ref) => ({ ref, choice: "uncensored" as const })) ?? [];
    if (selectedItems.length === 0) throw new Error("No uncensored confirmation refs provided");
    const selected = selectedItems.map((selection) => {
      const item = itemByRef.get(`${selection.ref.rootId}:${selection.ref.relativePath}`);
      if (!item)
        throw new Error(`Ref does not belong to scrape task: ${selection.ref.rootId}:${selection.ref.relativePath}`);
      const outcome = outcomeByItem.get(item.id);
      if (!outcome || outcome.outcome !== "success" || !outcome.outputRootId || !outcome.outputRelativePath) {
        throw new Error(
          `Ref does not belong to successful scrape output: ${selection.ref.rootId}:${selection.ref.relativePath}`,
        );
      }
      return { selection, item, outcome };
    });

    const configuration = await this.config.get();
    const roots = new Map<string, MediaRoot>();
    for (const { outcome } of selected) {
      const rootIds = [outcome.outputRootId, outcome.nfoRootId ?? outcome.outputRootId];
      for (const rootId of rootIds) {
        if (rootId && !roots.has(rootId)) roots.set(rootId, await this.mediaRoots.getActiveRoot(rootId));
      }
    }
    const resolvedSelected = selected.map(({ selection, item, outcome }) => {
      const { outputRootId, outputRelativePath } = outcome;
      if (!outputRootId || !outputRelativePath) {
        throw new Error(`Successful scrape outcome is missing output facts: ${outcome.id}`);
      }
      const outputRoot = roots.get(outputRootId);
      const nfoRoot = roots.get(outcome.nfoRootId ?? outputRootId);
      if (!outputRoot || !nfoRoot) {
        throw new Error(`Scrape output root disappeared before uncensored confirmation: ${outcome.id}`);
      }
      return { selection, item, outcome, outputRootId, outputRelativePath, outputRoot, nfoRoot };
    });
    const confirmation = await confirmUncensoredOutputs(
      resolvedSelected.map(({ selection, item, outcome, outputRelativePath, outputRoot, nfoRoot }) => ({
        fileId: item.id,
        videoPath: resolveRootRelativePath(outputRoot, outputRelativePath),
        metadataVideoPath: outcome.nfoRootId
          ? resolveRootRelativePath(nfoRoot, this.resolveMetadataVideoPath(this.toArtifactRecord(item, outcome)))
          : undefined,
        nfoPath: outcome.nfoRelativePath ? resolveRootRelativePath(nfoRoot, outcome.nfoRelativePath) : undefined,
        crawlerData: outcome.crawlerDataJson ? crawlerDataSchema.parse(JSON.parse(outcome.crawlerDataJson)) : undefined,
        choice: selection.choice,
      })),
      configuration,
      {
        artifactResolver: new MaintenanceArtifactResolver(),
        fileOrganizer: this.fileOrganizer,
        localScanService: new LocalScanService(),
        logger: runtimeLoggerService.getLogger(`scrape-confirm:${manifest.id}`),
        nfoGenerator: {
          writeNfo: async (nfoPath, data, options) =>
            await this.nfoGenerator.writeNfo(nfoPath, data, {
              ...options,
              buildTags: options?.buildTags ?? buildMovieTags,
            }),
        },
        pathExists: async (filePath) =>
          await stat(filePath)
            .then((value) => value.isFile())
            .catch(() => false),
      },
    );

    const updatedByItem = new Map(confirmation.items.map((item) => [item.fileId, item]));
    for (const {
      item,
      outcome,
      outputRootId,
      outputRelativePath: previousOutputRelativePath,
      outputRoot,
      nfoRoot,
    } of resolvedSelected) {
      const updated = updatedByItem.get(item.id);
      if (!updated) continue;
      const outputRelativePath = toRootRelativePath(outputRoot, updated.targetVideoPath);
      const nfoRelativePath = updated.targetNfoPath ? toRootRelativePath(nfoRoot, updated.targetNfoPath) : null;
      const existingEntry = await state.repositories.library.getEntry(outputRootId, previousOutputRelativePath);
      const fileStats = await stat(updated.targetVideoPath);
      const crawlerDataJson = outcome.crawlerDataJson ?? "{}";
      const crawlerData = crawlerDataSchema.parse(JSON.parse(crawlerDataJson));
      await state.repositories.scrapeRuns.reviseSuccess({
        outcomeId: outcome.id,
        crawlerDataJson,
        nfoRootId: nfoRelativePath && nfoRoot.id !== outputRoot.id ? nfoRoot.id : null,
        nfoRelativePath,
        outputRootId: outputRoot.id,
        outputRelativePath,
        uncensoredAmbiguous: false,
        size: fileStats.size,
        modifiedAt: fileStats.mtime,
        libraryEntry: {
          id: existingEntry.id,
          rootId: outputRoot.id,
          rootRelativePath: outputRelativePath,
          mediaIdentity: existingEntry.mediaIdentity,
          size: fileStats.size,
          modifiedAt: fileStats.mtime,
          title: existingEntry.title ?? crawlerData.title,
          number: existingEntry.number ?? crawlerData.number,
          actors: existingEntry.actors,
          crawlerDataJson,
          thumbnailPath: toRootRelativeAssetPath(nfoRoot, updated.assets.poster ?? updated.assets.thumb),
          assets: toLibraryAssets(nfoRoot, { ...updated.assets, downloaded: [] }),
          lastKnownPath: outputRelativePath,
          createdAt: existingEntry.createdAt,
          lastRefreshedAt: new Date(),
        },
      });
    }
    this.taskEvents.invalidate("scrape-history", "pending-confirmation");
    return manifest.id;
  }

  async nfoRead(input: NfoReadInput): Promise<NfoReadResponse> {
    return await this.nfoAdapter.read(input);
  }

  async nfoWrite(input: NfoWriteInput): Promise<NfoWriteResponse> {
    return await this.nfoAdapter.write(input);
  }

  async posterCropSession(id: string): Promise<PosterCropSessionResponse> {
    const context = await this.loadOutcomeContext(id);
    if (context.outcome.outcome !== "success" || !context.outcome.outputRelativePath) {
      throw new Error("Poster editing requires a successful scrape outcome with local output");
    }
    return await this.posterCropAdapter.session(this.toArtifactRecord(context.item, context.outcome));
  }

  async posterCropSave(input: PosterCropSaveInput): Promise<PosterCropSessionResponse> {
    const context = await this.loadOutcomeContext(input.id);
    if (context.outcome.outcome !== "success" || !context.outcome.outputRelativePath) {
      throw new Error("Poster editing requires a successful scrape outcome with local output");
    }
    return await this.posterCropAdapter.save(this.toArtifactRecord(context.item, context.outcome), input);
  }

  async deleteFile(input: FileActionInput): Promise<FileActionResponse> {
    const root = await this.mediaRoots.getActiveRoot(input.rootId);
    await rm(resolveRootRelativePath(root, input.relativePath), { force: true });
    return { ok: true, rootId: input.rootId, relativePath: input.relativePath };
  }

  async close(): Promise<void> {
    if (this.scrapeInvalidationTimer) {
      clearTimeout(this.scrapeInvalidationTimer);
      this.scrapeInvalidationTimer = null;
    }
    this.closing = true;
    this.scheduler.requestStop();
    this.readyRunIds.length = 0;
    await Promise.all([...this.runs.values()].map(async (entry) => await entry.session.abortForShutdown()));
    await this.scheduler.waitForIdle();
    this.runs.clear();
    this.activeRunId = null;
    if (this.scrapeInvalidationTimer) {
      clearTimeout(this.scrapeInvalidationTimer);
      this.scrapeInvalidationTimer = null;
    }
  }

  private async executeItem(
    manifest: ScrapeRunManifest,
    item: ScrapeRunItem<ServerManualScrape>,
    signal: AbortSignal,
    restGate: { waitBeforeStart(signal?: AbortSignal): Promise<void> } | undefined,
  ): Promise<ScrapeResult> {
    try {
      await restGate?.waitBeforeStart(signal);
      const root = await this.mediaRoots.getActiveRoot(item.rootId);
      const runtimeResult = await this.runtime.scrape({
        root,
        relativePath: item.relativePath,
        scrapeSessionId: manifest.id,
        manualScrape: this.resolveManualScrape(item.manualScrape?.manualUrl),
        progress: {
          fileIndex: (manifest.items.find((candidate) => candidate.id === item.id)?.ordinal ?? 0) + 1,
          totalFiles: manifest.items.length,
        },
        localState: item.manualScrape?.uncensoredChoice
          ? { uncensoredChoice: item.manualScrape.uncensoredChoice }
          : undefined,
        signal,
        onEvent: (type, message) => {
          this.addEvent(manifest.id, type, message, item.id);
        },
        onProgress: ({ value }) => {
          this.runs.get(manifest.id)?.session.recordProgress(value);
        },
        onStage: (stage, message) => {
          this.runs.get(manifest.id)?.session.recordStage({ stage, message, itemId: item.id });
        },
      });
      if (runtimeResult.status === "success") {
        this.pendingSuccesses.set(outcomeKey(manifest.id, item.id, item.attempt), { root, runtimeResult });
      }
      return { ...runtimeResult.result, fileId: item.id };
    } catch (error) {
      if (signal.aborted) throw error;
      return createFailedResult(item, errorMessage(error));
    }
  }

  private async commitItem(
    manifest: ScrapeRunManifest,
    item: ScrapeRunItem<ServerManualScrape>,
    result: ScrapeResult,
  ): Promise<ScrapeResult> {
    const repository = (await this.persistence.getState()).repositories.scrapeRuns;
    if (result.status === "success") {
      const key = outcomeKey(manifest.id, item.id, item.attempt);
      const pending = this.pendingSuccesses.get(key);
      if (!pending) throw new Error(`Missing successful scrape facts for item ${item.id}`);
      const { root, runtimeResult } = pending;
      const metadataRoot = await this.resolveMetadataRoot(root);
      const nfoRelativePath = runtimeResult.nfoPath ? toRootRelativePath(metadataRoot, runtimeResult.nfoPath) : null;
      const thumbnailPath = toRootRelativeAssetPath(
        metadataRoot,
        runtimeResult.result.assets?.poster ?? runtimeResult.result.assets?.thumb,
      );
      let committed: { outcome: ScrapeItemOutcomeRecord; entry: LibraryEntryRecord };
      try {
        committed = await repository.commitOutcome({
          outcome: "success",
          itemId: item.id,
          attempt: item.attempt,
          crawlerDataJson: JSON.stringify(runtimeResult.crawlerData),
          nfoRootId: nfoRelativePath && metadataRoot.id !== root.id ? metadataRoot.id : null,
          nfoRelativePath,
          outputRootId: root.id,
          outputRelativePath: runtimeResult.outputRelativePath,
          uncensoredAmbiguous: item.manualScrape?.uncensoredChoice
            ? false
            : (runtimeResult.result.uncensoredAmbiguous ?? false),
          size: runtimeResult.size,
          modifiedAt: runtimeResult.modifiedAt,
          libraryEntry: {
            rootId: root.id,
            rootRelativePath: runtimeResult.outputRelativePath,
            mediaIdentity: runtimeResult.crawlerData.number,
            size: runtimeResult.size,
            modifiedAt: runtimeResult.modifiedAt,
            title: runtimeResult.crawlerData.title,
            number: runtimeResult.crawlerData.number,
            actors: runtimeResult.crawlerData.actors,
            crawlerDataJson: JSON.stringify(runtimeResult.crawlerData),
            thumbnailPath:
              thumbnailPath ?? runtimeResult.crawlerData.thumb_url ?? runtimeResult.crawlerData.poster_url ?? null,
            assets: toLibraryAssets(metadataRoot, runtimeResult.result.assets),
            lastKnownPath: runtimeResult.outputRelativePath,
          },
        });
      } catch (error) {
        this.pendingSuccesses.delete(key);
        const coordinatedError = formatDiskCommitFailure(error);
        const failure = await repository.commitOutcome({
          outcome: "failed",
          itemId: item.id,
          attempt: item.attempt,
          error: coordinatedError,
        });
        this.addEvent(manifest.id, "item-failed", `${item.relativePath}: ${coordinatedError}`, item.id);
        return { ...result, resultId: failure.id, status: "failed", error: coordinatedError };
      }
      this.pendingSuccesses.delete(key);
      this.addEvent(manifest.id, "item-success", `Generated NFO: ${nfoRelativePath ?? "not generated"}`, item.id);
      const assetDto = toScrapeAssetDto(committed.entry.assets);
      return {
        ...result,
        ...scrapeAssetReferencesToResult(assetDto),
        resultId: committed.outcome.id,
        status: "success",
      };
    }

    const message = result.error?.trim() || (result.status === "skipped" ? "刮削项目已跳过" : "刮削失败");
    const outcome =
      result.status === "skipped"
        ? await repository.commitOutcome({
            outcome: "skipped",
            itemId: item.id,
            attempt: item.attempt,
            error: message,
          })
        : await repository.commitOutcome({
            outcome: "failed",
            itemId: item.id,
            attempt: item.attempt,
            error: message,
          });
    this.addEvent(
      manifest.id,
      outcome.outcome === "skipped" ? "item-skipped" : "item-failed",
      `${item.relativePath}: ${message}`,
      item.id,
    );
    return { ...result, resultId: outcome.id, status: outcome.outcome, error: message };
  }

  private claimNext(): LiveQueueEntry | null {
    while (!this.closing) {
      const runId = this.readyRunIds.shift();
      if (!runId) return null;
      const entry = this.runs.get(runId);
      if (!entry || entry.status !== "queued") continue;
      entry.status = "running";
      entry.startedAt ??= new Date();
      this.activeRunId = runId;
      const task = this.liveTaskDto(entry.manifest, entry, entry.session.snapshot());
      this.addEvent(entry.runId, "running", "Scrape task started");
      this.taskEvents.lifecycle(task);
      this.scheduleScrapeInvalidation();
      return entry;
    }
    return null;
  }

  private async runEntry(entry: LiveQueueEntry): Promise<void> {
    try {
      const status = entry.session.snapshot().status;
      if (status === "queued") await entry.session.start();
      else if (status === "paused") await entry.session.resume();
      else throw new Error(`Cannot schedule scrape session in ${status} state: ${entry.runId}`);
      await entry.session.waitForIdle();
      if (this.closing) return;
      const snapshot = entry.session.snapshot();
      if (snapshot.status === "completed" || snapshot.status === "failed" || snapshot.status === "stopped") {
        await this.settleEntry(entry, snapshot);
      }
    } finally {
      if (this.activeRunId === entry.runId) this.activeRunId = null;
    }
  }

  private async stopEntry(entry: LiveQueueEntry): Promise<void> {
    entry.status = "stopping";
    this.removeReadyRun(entry.runId);
    this.addEvent(entry.runId, "stopping", "Stopping scrape task");
    this.scheduleScrapeInvalidation();
    await this.settleEntry(entry, await entry.session.stop());
  }

  private async settleEntry(entry: LiveQueueEntry, snapshot: ScrapeRunSnapshot<ServerManualScrape>): Promise<void> {
    entry.settlement ??= this.settleRun(entry.manifest, snapshot, entry.startedAt);
    await entry.settlement;
    if (this.runs.get(entry.runId) !== entry) return;
    this.runs.delete(entry.runId);
    this.removeReadyRun(entry.runId);
    this.scheduleScrapeInvalidation();
  }

  private requireLive(runId: string): LiveQueueEntry {
    const entry = this.runs.get(runId);
    if (!entry) throw new Error(`Scrape run is not live in this backend process: ${runId}`);
    return entry;
  }

  private removeReadyRun(runId: string): void {
    for (let index = this.readyRunIds.length - 1; index >= 0; index -= 1) {
      if (this.readyRunIds[index] === runId) this.readyRunIds.splice(index, 1);
    }
  }

  private liveEntries(): LiveQueueEntry[] {
    const ordered = [this.activeRunId, ...this.readyRunIds].filter((runId): runId is string =>
      Boolean(runId && this.runs.has(runId)),
    );
    const seen = new Set(ordered);
    return [...ordered, ...[...this.runs.keys()].filter((runId) => !seen.has(runId))]
      .map((runId) => this.runs.get(runId))
      .filter((entry): entry is LiveQueueEntry => Boolean(entry));
  }

  private async settleRun(
    manifest: ScrapeRunManifest,
    snapshot: ScrapeRunSnapshot<ServerManualScrape>,
    startedAt: Date | null,
  ): Promise<void> {
    try {
      const state = await this.persistence.getState();
      const repository = state.repositories.scrapeRuns;
      const disposition =
        snapshot.status === "completed" ? "completed" : snapshot.status === "stopped" ? "stopped" : "failed";
      const finalized = await repository.finalize({
        runId: manifest.id,
        disposition,
        error: snapshot.error ?? (snapshot.status === "stopped" ? STOPPED_MESSAGE : null),
        startedAt,
      });
      const summary = repository.summary(finalized);
      if (!summary) throw new Error(`Scrape run finalization disappeared after update: ${manifest.id}`);
      const terminalRun = await this.historyRunDto(finalized);
      const terminalStatus = summary.disposition === "completed" ? "completed" : "failed";
      this.addEvent(
        manifest.id,
        terminalStatus,
        terminalStatus === "completed"
          ? `Scrape completed. Succeeded: ${summary.successCount}, Failed: ${summary.failedCount}`
          : `Scrape failed. Succeeded: ${summary.successCount}, Failed: ${summary.failedCount}, Skipped: ${summary.skippedCount}`,
      );
      this.taskEvents.lifecycle({
        id: terminalRun.id,
        kind: "scrape",
        rootId: terminalRun.rootId,
        rootDisplayName: terminalRun.rootDisplayName,
        status: terminalStatus,
        startedAt: terminalRun.startedAt,
        completedAt: terminalRun.completedAt,
        error: terminalRun.error,
      });
      this.taskEvents.invalidate("scrape-history", "pending-confirmation");
    } catch (error) {
      runtimeLoggerService
        .getLogger(`scrape:${manifest.id}`)
        .error(`Failed to finalize scrape run; it will project as interrupted: ${errorMessage(error)}`);
    } finally {
      this.pendingSuccesses.forEach((_value, key) => {
        if (key.startsWith(`${manifest.id}\u0000`)) this.pendingSuccesses.delete(key);
      });
    }
  }

  private handleSessionSnapshot(): void {
    this.scheduleScrapeInvalidation();
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
    const session = this.runs.get(runId)?.session;
    session?.recordLog({
      level: type.includes("failed") ? "error" : "info",
      message,
      itemId: itemId ?? null,
      timestamp: createdAt,
    });
    this.taskEvents.log(decorateTaskLog(event));
    return event;
  }

  private liveTaskDto(
    manifest: ScrapeRunManifest,
    entry: LiveQueueEntry,
    snapshot: ScrapeRunSnapshot<ServerManualScrape>,
  ): ScanTaskDto {
    const status = entry.status;
    const successCount = snapshot.items.filter((item) => item.status === "success").length;
    return {
      ...toScanTaskDto(
        {
          id: manifest.id,
          kind: "scrape",
          rootId: manifest.rootId,
          status,
          createdAt: manifest.createdAt,
          updatedAt: new Date(),
          startedAt: entry.startedAt,
          completedAt: null,
          videoCount: successCount,
          directoryCount: 0,
          error: snapshot.error,
        },
        {
          rootDisplayName: entry.rootDisplayName,
          videos: manifest.items.map((item) => item.relativePath),
        },
      ),
      continuity: "live",
    };
  }

  private async historyRunDto(manifest: ScrapeRunManifest): Promise<ScrapeHistoryRunDto> {
    const repository = (await this.persistence.getState()).repositories.scrapeRuns;
    const summary = repository.summary(manifest);
    const outcomes = repository.latestOutcomes(manifest);
    return {
      id: manifest.id,
      rootId: manifest.rootId,
      rootDisplayName: await this.getRootDisplayName(manifest.rootId),
      requestedOutputRootId: manifest.requestedOutputRootId,
      outputRootId: summary?.outputRootId ?? null,
      executionMode: manifest.executionMode,
      disposition: summary?.disposition ?? "interrupted",
      createdAt: manifest.createdAt.toISOString(),
      startedAt: summary?.startedAt?.toISOString() ?? null,
      completedAt: summary?.completedAt.toISOString() ?? null,
      successCount: summary?.successCount ?? outcomes.filter((outcome) => outcome.outcome === "success").length,
      failedCount: summary?.failedCount ?? outcomes.filter((outcome) => outcome.outcome === "failed").length,
      skippedCount: summary?.skippedCount ?? outcomes.filter((outcome) => outcome.outcome === "skipped").length,
      totalBytes:
        summary?.totalBytes ??
        outcomes.reduce((total, outcome) => total + (outcome.outcome === "success" ? outcome.size : 0), 0),
      error: summary?.error ?? SCRAPE_BACKEND_INTERRUPTED_MESSAGE,
    };
  }

  private async outcomeToDto(context: OutcomeContext): Promise<ScrapeResultDto> {
    const libraryEntry = await (await this.persistence.getState()).repositories.library.getEntryBySourceOutcomeId(
      context.outcome.id,
    );
    return toScrapeResultDto(context.outcome, context.item, {
      runId: context.manifest.id,
      rootDisplayName: await this.getRootDisplayName(context.item.rootId),
      runCreatedAt: context.manifest.createdAt,
      assets: libraryEntry?.assets ?? [],
    });
  }

  private async liveRunSnapshotDto(
    manifest: ScrapeRunManifest,
    entry: LiveQueueEntry,
    snapshot: ScrapeRunSnapshot<ServerManualScrape>,
  ): Promise<ScrapeLiveRunSnapshotDto> {
    return {
      task: this.liveTaskDto(manifest, entry, snapshot),
      progress: { ...snapshot.progress },
      items: snapshot.items.map((item) => this.liveItemToDto(manifest, item)),
      latestStage: snapshot.latestStage
        ? {
            stage: snapshot.latestStage.stage,
            message: snapshot.latestStage.message,
            relativePath: snapshot.latestStage.relativePath,
          }
        : null,
      logs: snapshot.logs.map((log, index) => this.liveLogToDto(manifest.id, log, index)),
      ambiguousUncensoredItems: this.liveAmbiguousUncensoredItems(snapshot),
    };
  }

  private liveItemToDto(
    manifest: ScrapeRunManifest,
    item: ScrapeRunItemSnapshot<ServerManualScrape>,
  ): ScrapeLiveItemDto {
    const manifestItem = manifest.items.find((candidate) => candidate.id === item.id);
    if (!manifestItem) throw new Error(`Scrape item not found in manifest: ${item.id}`);
    const assetRootId = item.result?.assets?.rootId ?? null;
    return {
      id: item.id,
      resultId: item.result?.resultId ?? null,
      rootId: item.rootId,
      relativePath: item.relativePath,
      fileName: path.posix.basename(item.relativePath),
      status: item.status,
      error: item.error,
      crawlerData: item.result?.crawlerData ?? null,
      nfoRootId: item.result?.nfoRootId ?? null,
      nfoRelativePath: item.result?.nfoPath ?? null,
      outputRootId: null,
      outputRelativePath: item.result?.outputPath ?? null,
      assetRootId,
      sceneImageRelativePaths: assetRootId ? (item.result?.assets?.sceneImages ?? []) : [],
      trailerRelativePath: assetRootId ? (item.result?.assets?.trailer ?? null) : null,
      manualUrl: manifestItem.manualUrl,
      uncensoredAmbiguous: item.result?.uncensoredAmbiguous === true,
      attempt: item.attempt,
    };
  }

  private liveLogToDto(
    runId: string,
    log: ScrapeRunSnapshot<ServerManualScrape>["logs"][number],
    index: number,
  ): LogEntryDto {
    const createdAt = log.timestamp.toISOString();
    return {
      id: `${runId}:live-log:${createdAt}:${index}`,
      taskId: runId,
      type: "live-log",
      message: log.message,
      createdAt,
      source: "task",
      level: log.level === "error" ? "ERR" : log.level === "warn" ? "WARN" : log.level === "debug" ? "INFO" : "INFO",
    };
  }

  private liveAmbiguousUncensoredItems(snapshot: ScrapeRunSnapshot<ServerManualScrape>): AmbiguousUncensoredItemDto[] {
    return snapshot.items
      .filter((item) => item.status === "success" && item.result?.uncensoredAmbiguous === true)
      .map((item) => ({
        id: item.result?.resultId ?? item.id,
        ref: { rootId: item.rootId, relativePath: item.relativePath },
        fileId: item.id,
        fileName: path.posix.basename(item.relativePath),
        number:
          item.result?.crawlerData?.number ??
          path.posix.basename(item.relativePath, path.posix.extname(item.relativePath)),
        title: item.result?.crawlerData?.title_zh ?? item.result?.crawlerData?.title ?? null,
        nfoRelativePath: item.result?.nfoPath ?? null,
      }));
  }

  private async loadOutcomeContext(outcomeId: string): Promise<OutcomeContext> {
    const repository = (await this.persistence.getState()).repositories.scrapeRuns;
    const manifests = await repository.list();
    const manifest = manifests.find((candidate) => candidate.outcomes.some((outcome) => outcome.id === outcomeId));
    if (!manifest) throw new Error(`Scrape outcome not found: ${outcomeId}`);
    const outcome = manifest.outcomes.find((candidate) => candidate.id === outcomeId);
    if (!outcome) throw new Error(`Scrape outcome not found: ${outcomeId}`);
    const item = manifest.items.find((candidate) => candidate.id === outcome.itemId);
    if (!item) throw new Error(`Scrape outcome item is missing from manifest: ${outcome.itemId}`);
    return { manifest, item, outcome };
  }

  private async buildAmbiguousUncensoredItems(runId: string): Promise<AmbiguousUncensoredItemDto[]> {
    const state = await this.persistence.getState();
    const manifest = await state.repositories.scrapeRuns.get(runId);
    const itemById = new Map(manifest.items.map((item) => [item.id, item]));
    return state.repositories.scrapeRuns
      .latestOutcomes(manifest)
      .filter((outcome) => outcome.outcome === "success" && outcome.uncensoredAmbiguous)
      .flatMap((outcome) => {
        const item = itemById.get(outcome.itemId);
        if (!item) return [];
        const crawlerData = outcome.crawlerDataJson
          ? crawlerDataSchema.parse(JSON.parse(outcome.crawlerDataJson))
          : null;
        return [
          {
            id: outcome.id,
            ref: { rootId: item.rootId, relativePath: item.relativePath },
            fileId: item.id,
            fileName: path.posix.basename(item.relativePath),
            number:
              crawlerData?.number || path.posix.basename(item.relativePath, path.posix.extname(item.relativePath)),
            title: crawlerData?.title_zh || crawlerData?.title || null,
            nfoRelativePath: outcome.nfoRelativePath,
          },
        ];
      });
  }

  private toArtifactRecord(item: ScrapeRunItemRecord, outcome: ScrapeItemOutcomeRecord): ServerScrapeArtifactRecord {
    return {
      rootId: item.rootId,
      relativePath: item.relativePath,
      nfoRootId: outcome.nfoRootId,
      outputRootId: outcome.outputRootId,
      outputRelativePath: outcome.outputRelativePath,
    };
  }

  private resolveManualScrape(
    manualUrl?: string | null,
  ): Parameters<MountedRootScrapeRuntime["scrape"]>[0]["manualScrape"] {
    const trimmed = manualUrl?.trim();
    if (!trimmed) return undefined;
    const validation = validateManualScrapeUrl(trimmed);
    if (!validation.valid) throw new Error(validation.message);
    return { site: validation.route.site, detailUrl: validation.route.detailUrl };
  }

  private async resolveMetadataRoot(primaryRoot: MediaRoot): Promise<MediaRoot> {
    const metadataPath = (await this.config.get()).paths.metadataPath.trim();
    return metadataPath ? await this.mediaRoots.ensureMetadataRoot(metadataPath) : primaryRoot;
  }

  private resolveMetadataVideoPath(result: ServerScrapeArtifactRecord): string {
    const outputRelativePath = result.outputRelativePath ?? result.relativePath;
    return result.nfoRootId
      ? path.posix.join(
          path.posix.dirname(outputRelativePath),
          `${path.posix.basename(outputRelativePath, path.posix.extname(outputRelativePath))}.strm`,
        )
      : outputRelativePath;
  }

  private async getRootDisplayName(rootId: string): Promise<string> {
    const root = await (await this.persistence.getState()).repositories.mediaRoots
      .get(rootId, { includeDeleted: true })
      .catch(() => null);
    return root?.displayName ?? "未知媒体目录";
  }

  private scheduleScrapeInvalidation(): void {
    if (this.scrapeInvalidationTimer) return;
    this.scrapeInvalidationTimer = setTimeout(() => {
      this.scrapeInvalidationTimer = null;
      this.taskEvents.invalidate("scrape-live");
    }, 250);
  }
}
