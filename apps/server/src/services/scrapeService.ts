import { randomUUID } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { type MediaRoot, resolveRootRelativePath, toRootRelativePath } from "@mdcz/media-store";
import type {
  ScrapeItemOutcomeRecord,
  ScrapeRunItemRecord,
  ScrapeRunManifest,
  ScrapeRunSummaryRecord,
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
} from "@mdcz/runtime/tasks";
import type { TranslationMappingStore } from "@mdcz/runtime/translate";
import { validateManualScrapeUrl } from "@mdcz/shared/manualScrapeUrl";
import {
  type AmbiguousUncensoredItemDto,
  crawlerDataSchema,
  type FileActionInput,
  type FileActionResponse,
  type LogEntryDto,
  type LogListResponse,
  type NfoReadInput,
  type NfoReadResponse,
  type NfoWriteInput,
  type NfoWriteResponse,
  type PosterCropSaveInput,
  type PosterCropSessionResponse,
  type ScanTaskDetailResponse,
  type ScanTaskDto,
  type ScanTaskListResponse,
  type ScrapeConfirmUncensoredInput,
  type ScrapeLiveItemDto,
  type ScrapeLiveRunSnapshotDto,
  type ScrapeLiveRunsResponse,
  type ScrapePendingUncensoredConfirmationResponse,
  type ScrapeResultDetailResponse,
  type ScrapeResultDto,
  type ScrapeResultListResponse,
  type ScrapeStartInput,
  type ScrapeStartSelectedFilesInput,
  type ScrapeTaskControlInput,
  type TaskEventDto,
  type TaskEventListResponse,
} from "@mdcz/shared/serverDtos";
import type { ScrapeResult, UncensoredChoice } from "@mdcz/shared/types";
import { getServerImageHostCooldownStore } from "../imageHostCooldownStore";
import { toRootRelativeAssetPath, toScrapeResultDto } from "../scrapeDtos";
import { createServerScrapeRuntime } from "../scrapeRuntimeFactory";
import { toScanTaskDto } from "../taskDto";
import type { TaskEventBus } from "../taskEvents";
import type { ServerConfigService } from "./configService";
import type { MediaRootService } from "./mediaRootService";
import type { ServerPersistenceService } from "./persistenceService";
import { decorateTaskLog } from "./runtimeLogService";
import { ServerNfoAdapter, ServerPosterCropAdapter, type ServerScrapeArtifactRecord } from "./scrapeAdapters";
import { ServerScrapeQueue, type ServerScrapeQueueEntry } from "./serverScrapeQueue";

export const SCRAPE_BACKEND_INTERRUPTED_MESSAGE = "刮削后端已重启，任务已中断；请重新扫描磁盘并基于当前文件创建新任务";
const INTERRUPTED_RETRY_MESSAGE = "中断任务必须先重新扫描磁盘，再从当前文件列表创建新任务";
const STOPPED_MESSAGE = "刮削已停止";
const TERMINAL_SNAPSHOT_LIMIT = 25;

type ServerManualScrape = {
  manualUrl: string | null;
  uncensoredChoice: UncensoredChoice | null;
};

type LiveQueueEntry = ServerScrapeQueueEntry<ServerManualScrape>;

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

const isTerminalSnapshot = (snapshot: ScrapeRunSnapshot<ServerManualScrape>): boolean =>
  snapshot.status === "completed" || snapshot.status === "failed" || snapshot.status === "stopped";

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
  private readonly liveManifests = new Map<string, ScrapeRunManifest>();
  private readonly rootDisplayNames = new Map<string, string>();
  private readonly snapshots = new Map<string, ScrapeRunSnapshot<ServerManualScrape>>();
  private readonly snapshotUpdatedAt = new Map<string, Date>();
  private readonly eventsByRun = new Map<string, TaskEventDto[]>();
  private readonly lastPublishedStatus = new Map<string, ScanTaskDto["status"]>();
  private readonly pendingSuccesses = new Map<string, PendingSuccess>();
  private readonly networkClient = new NetworkClient();
  private readonly fileOrganizer = new FileOrganizer();
  private readonly nfoGenerator = new NfoGenerator();
  private readonly posterCropService = new PosterCropService();
  private readonly nfoAdapter: ServerNfoAdapter;
  private readonly posterCropAdapter: ServerPosterCropAdapter;
  private readonly runtime: MountedRootScrapeRuntime;
  private readonly queue: ServerScrapeQueue<ServerManualScrape>;
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
    this.queue = new ServerScrapeQueue((runId) => this.handleQueueChange(runId));
  }

  async start(
    input: ScrapeStartInput,
    options?: { uncensoredChoices?: Map<string, UncensoredChoice> },
  ): Promise<ScanTaskDto> {
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
    const state = await this.persistence.getState();
    const manifest = await state.repositories.scrapeRuns.createRun({
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

    for (const [rootId, root] of roots) this.rootDisplayNames.set(rootId, root.displayName);
    this.liveManifests.set(manifest.id, manifest);
    this.snapshotUpdatedAt.set(manifest.id, manifest.createdAt);
    const session = new ScrapeRunSession<ServerManualScrape>({
      runId: manifest.id,
      items: manifest.items.map((item) => {
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
      }),
      concurrency: policy.concurrency,
      executeItem: async (item, signal) => await this.executeItem(manifest, item, signal, policy.restGate ?? undefined),
      commitItem: async (item, result) => await this.commitItem(manifest, item, result),
      onSnapshot: (snapshot) => this.handleSessionSnapshot(manifest, snapshot),
    });
    this.snapshots.set(manifest.id, session.snapshot());
    try {
      this.queue.submit({
        runId: manifest.id,
        session,
        createdAt: manifest.createdAt,
        settle: async (snapshot, startedAt) => await this.settleRun(manifest, snapshot, startedAt),
      });
    } catch (error) {
      this.liveManifests.delete(manifest.id);
      this.snapshots.delete(manifest.id);
      this.snapshotUpdatedAt.delete(manifest.id);
      throw error;
    }
    return await this.toDto(manifest.id);
  }

  async startSelectedFiles(input: ScrapeStartSelectedFilesInput): Promise<ScanTaskDto> {
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

  async list(): Promise<ScanTaskListResponse> {
    const manifests = await (await this.persistence.getState()).repositories.scrapeRuns.listRuns();
    return { tasks: await Promise.all(manifests.map(async (manifest) => await this.toDto(manifest.id))) };
  }

  /**
   * The only live scrape read model.  It intentionally reads only the
   * currently running process queue; durable manifests and outcomes remain
   * available through the history endpoints instead.
   */
  async liveRuns(): Promise<ScrapeLiveRunsResponse> {
    const entries = this.queue.list();
    const runs: ScrapeLiveRunSnapshotDto[] = [];
    for (const entry of entries) {
      // Settlement removes the manifest before the queue entry is finally
      // unlinked.  Treat that narrow hand-off as already non-live instead of
      // turning an otherwise valid authority read into a 500 response.
      const manifest = this.liveManifests.get(entry.runId);
      if (!manifest) continue;
      runs.push(await this.liveRunSnapshotDto(manifest, entry, entry.session.snapshot()));
    }
    return { runs };
  }

  /**
   * Uncensored confirmation is durable post-processing, not live-session
   * recovery.  Terminal outcomes remain queryable after a backend restart.
   */
  async pendingUncensoredConfirmation(): Promise<ScrapePendingUncensoredConfirmationResponse> {
    const repository = (await this.persistence.getState()).repositories.scrapeRuns;
    const manifests = await repository.listRuns();
    const items = (
      await Promise.all(
        manifests.map(async (manifest) =>
          (await this.buildAmbiguousUncensoredItems(manifest.id)).map((item) => ({ ...item, taskId: manifest.id })),
        ),
      )
    ).flat();
    return { items };
  }

  async detail(taskId: string): Promise<ScanTaskDetailResponse> {
    return { task: await this.toDto(taskId), events: (await this.events(taskId)).events };
  }

  async events(taskId: string): Promise<TaskEventListResponse> {
    const liveEvents = this.eventsByRun.get(taskId);
    if (liveEvents) return { events: liveEvents.map((event) => ({ ...event })) };
    const state = await this.persistence.getState();
    const manifest = await state.repositories.scrapeRuns.getRun(taskId);
    const summary = await state.repositories.scrapeRuns.getSummary(taskId);
    if (summary) {
      const completed = summary.disposition === "completed";
      return {
        events: [
          {
            id: `${taskId}:terminal`,
            taskId,
            type: completed ? "completed" : "failed",
            message: completed
              ? `Scrape completed. Succeeded: ${summary.successCount}, Failed: ${summary.failedCount}`
              : `Scrape failed. Succeeded: ${summary.successCount}, Failed: ${summary.failedCount}, Skipped: ${summary.skippedCount}`,
            createdAt: summary.completedAt.toISOString(),
          },
        ],
      };
    }
    return {
      events: [
        {
          id: `${taskId}:backend-interrupted`,
          taskId,
          type: "failed",
          message: SCRAPE_BACKEND_INTERRUPTED_MESSAGE,
          createdAt: manifest.createdAt.toISOString(),
        },
      ],
    };
  }

  async logs(): Promise<LogListResponse> {
    const manifests = await (await this.persistence.getState()).repositories.scrapeRuns.listRuns();
    const logs = (
      await Promise.all(
        manifests.map(async (manifest) => {
          const events = this.eventsByRun.get(manifest.id) ?? (await this.events(manifest.id)).events;
          return events.map((event) => ({ ...event, source: "task" as const }));
        }),
      )
    )
      .flat()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return { logs };
  }

  async listResults(input?: ScrapeTaskControlInput): Promise<ScrapeResultListResponse> {
    const state = await this.persistence.getState();
    const manifests = input?.taskId
      ? [await state.repositories.scrapeRuns.getRun(input.taskId)]
      : await state.repositories.scrapeRuns.listRuns();
    const results: ScrapeResultDto[] = [];
    for (const manifest of manifests) {
      const latest = await state.repositories.scrapeRuns.listLatestOutcomes(manifest.id);
      const itemById = new Map(manifest.items.map((item) => [item.id, item]));
      for (const outcome of latest) {
        const item = itemById.get(outcome.itemId);
        if (!item) throw new Error(`Scrape outcome item is missing from manifest: ${outcome.itemId}`);
        results.push(await this.outcomeToDto({ manifest, item, outcome }));
      }
    }
    return { results };
  }

  async result(id: string): Promise<ScrapeResultDetailResponse> {
    return { result: await this.outcomeToDto(await this.loadOutcomeContext(id)) };
  }

  async stop(input: ScrapeTaskControlInput): Promise<ScanTaskDto> {
    await this.queue.stop(input.taskId);
    return await this.toDto(input.taskId);
  }

  async pause(input: ScrapeTaskControlInput): Promise<ScanTaskDto> {
    await this.queue.pause(input.taskId);
    return await this.toDto(input.taskId);
  }

  async resume(input: ScrapeTaskControlInput): Promise<ScanTaskDto> {
    this.queue.resume(input.taskId);
    return await this.toDto(input.taskId);
  }

  async retry(input: ScrapeTaskControlInput): Promise<ScanTaskDto> {
    const state = await this.persistence.getState();
    const manifest = await state.repositories.scrapeRuns.getRun(input.taskId);
    const summary = await state.repositories.scrapeRuns.getSummary(input.taskId);
    if (!summary) throw new Error(INTERRUPTED_RETRY_MESSAGE);
    const latest = await state.repositories.scrapeRuns.listLatestOutcomes(input.taskId);
    const retryItemIds = new Set(
      latest
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
        outputRootId: manifest.outputRootId ?? undefined,
        manualUrl: retryItems.every((item) => item.manualUrl === retryItems[0]?.manualUrl)
          ? (retryItems[0]?.manualUrl ?? undefined)
          : undefined,
        uncensoredConfirmed: choices.size > 0,
      },
      { uncensoredChoices: choices },
    );
  }

  async confirmUncensored(input: ScrapeConfirmUncensoredInput): Promise<ScanTaskDto> {
    const state = await this.persistence.getState();
    const manifest = await state.repositories.scrapeRuns.getRun(input.taskId);
    const summary = await state.repositories.scrapeRuns.getSummary(input.taskId);
    if (!summary) throw new Error("无码确认只允许修改已结束刮削的成功结果");
    const outcomes = await state.repositories.scrapeRuns.listLatestOutcomes(input.taskId);
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
      const revised = await state.repositories.scrapeRuns.reviseSuccess({
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
      this.taskEvents.publishRealtime({
        id: `${revised.outcome.id}:result:${revised.outcome.completedAt.toISOString()}`,
        taskId: manifest.id,
        createdAt: new Date().toISOString(),
        kind: "scrape-result",
        result: await this.outcomeToDto({ manifest, item, outcome: revised.outcome }),
      });
    }
    this.taskEvents.publish({ kind: "task", task: await this.toDto(manifest.id) });
    this.scheduleScrapeInvalidation();
    return await this.toDto(manifest.id);
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
    await this.queue.beginClose();
    if (this.scrapeInvalidationTimer) {
      clearTimeout(this.scrapeInvalidationTimer);
      this.scrapeInvalidationTimer = null;
    }
    this.liveManifests.clear();
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
        onProgress: ({ value, current, total }) => {
          const createdAt = new Date().toISOString();
          this.taskEvents.publishRealtime({
            id: `${item.id}:progress:${current}:${value}:${createdAt}`,
            taskId: manifest.id,
            createdAt,
            kind: "task-progress",
            taskKind: "scrape",
            value,
            current,
            total,
            message: item.relativePath,
          });
        },
        onStage: (stage, message) => {
          this.queue.get(manifest.id)?.session.recordStage({ stage, message, itemId: item.id });
          const createdAt = new Date().toISOString();
          this.taskEvents.publishRealtime({
            id: `${item.id}:stage:${stage}:${createdAt}`,
            taskId: manifest.id,
            createdAt,
            kind: "scrape-stage",
            stage,
            message,
            relativePath: item.relativePath,
          });
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
      let committed: Awaited<ReturnType<typeof repository.commitSuccess>>;
      try {
        committed = await repository.commitSuccess({
          runId: manifest.id,
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
        const failure = await repository.commitFailure({
          runId: manifest.id,
          itemId: item.id,
          attempt: item.attempt,
          error: coordinatedError,
        });
        await this.publishCommittedOutcome(manifest, item.id, failure);
        this.addEvent(manifest.id, "item-failed", `${item.relativePath}: ${coordinatedError}`, item.id);
        return { ...result, resultId: failure.id, status: "failed", error: coordinatedError };
      }
      this.pendingSuccesses.delete(key);
      await this.publishCommittedOutcome(manifest, item.id, committed.outcome);
      this.addEvent(manifest.id, "item-success", `Generated NFO: ${nfoRelativePath ?? "not generated"}`, item.id);
      return { ...result, resultId: committed.outcome.id, status: "success" };
    }

    const message = result.error?.trim() || (result.status === "skipped" ? "刮削项目已跳过" : "刮削失败");
    const outcome =
      result.status === "skipped"
        ? await repository.commitSkipped({
            runId: manifest.id,
            itemId: item.id,
            attempt: item.attempt,
            error: message,
          })
        : await repository.commitFailure({
            runId: manifest.id,
            itemId: item.id,
            attempt: item.attempt,
            error: message,
          });
    await this.publishCommittedOutcome(manifest, item.id, outcome);
    this.addEvent(
      manifest.id,
      outcome.outcome === "skipped" ? "item-skipped" : "item-failed",
      `${item.relativePath}: ${message}`,
      item.id,
    );
    return { ...result, resultId: outcome.id, status: outcome.outcome, error: message };
  }

  private async settleRun(
    manifest: ScrapeRunManifest,
    snapshot: ScrapeRunSnapshot<ServerManualScrape>,
    startedAt: Date | null,
  ): Promise<void> {
    try {
      const state = await this.persistence.getState();
      const repository = state.repositories.scrapeRuns;
      const latest = await repository.listLatestOutcomes(manifest.id);
      const firstSuccess = latest.find((outcome) => outcome.outcome === "success");
      const outputRoot = firstSuccess?.outputRootId
        ? await state.repositories.mediaRoots.get(firstSuccess.outputRootId, { includeDeleted: true })
        : null;
      const disposition =
        snapshot.status === "completed" ? "completed" : snapshot.status === "stopped" ? "stopped" : "failed";
      const summary = await repository.finalizeRun({
        runId: manifest.id,
        disposition,
        outputRootId: firstSuccess?.outputRootId ?? null,
        outputDirectory: outputRoot?.hostPath ?? null,
        error: snapshot.error ?? (snapshot.status === "stopped" ? STOPPED_MESSAGE : null),
        startedAt,
      });
      this.snapshots.set(manifest.id, snapshot);
      this.snapshotUpdatedAt.set(manifest.id, summary.completedAt);
      const terminalTask = await this.historyTaskDto(manifest, summary);
      this.lastPublishedStatus.set(manifest.id, terminalTask.status);
      const completedEvent = this.addEvent(
        manifest.id,
        terminalTask.status,
        terminalTask.status === "completed"
          ? `Scrape completed. Succeeded: ${summary.successCount}, Failed: ${summary.failedCount}`
          : `Scrape failed. Succeeded: ${summary.successCount}, Failed: ${summary.failedCount}, Skipped: ${summary.skippedCount}`,
      );
      const ambiguousUncensoredItems = await this.buildAmbiguousUncensoredItems(manifest.id);
      this.taskEvents.publish({
        kind: "event",
        event: completedEvent,
        ...(ambiguousUncensoredItems.length > 0 ? { ambiguousUncensoredItems } : {}),
      });
      this.taskEvents.publish({ kind: "task", task: terminalTask });
    } catch (error) {
      runtimeLoggerService
        .getLogger(`scrape:${manifest.id}`)
        .error(`Failed to finalize scrape run; it will project as interrupted: ${errorMessage(error)}`);
    } finally {
      this.liveManifests.delete(manifest.id);
      this.pendingSuccesses.forEach((_value, key) => {
        if (key.startsWith(`${manifest.id}\u0000`)) this.pendingSuccesses.delete(key);
      });
      this.retainTerminalSnapshots();
    }
  }

  private handleSessionSnapshot(manifest: ScrapeRunManifest, snapshot: ScrapeRunSnapshot<ServerManualScrape>): void {
    this.snapshots.set(manifest.id, snapshot);
    this.snapshotUpdatedAt.set(manifest.id, new Date());
    this.scheduleScrapeInvalidation();
    if (!isTerminalSnapshot(snapshot)) this.publishLiveTask(manifest, snapshot);
  }

  private handleQueueChange(runId: string | null): void {
    this.scheduleScrapeInvalidation();
    if (!runId) return;
    const manifest = this.liveManifests.get(runId);
    const entry = this.queue.get(runId);
    if (!manifest || !entry) return;
    this.publishLiveTask(manifest, entry.session.snapshot(), entry);
  }

  private publishLiveTask(
    manifest: ScrapeRunManifest,
    snapshot: ScrapeRunSnapshot<ServerManualScrape>,
    entry = this.queue.get(manifest.id),
  ): void {
    if (!entry) return;
    const task = this.liveTaskDto(manifest, entry, snapshot);
    if (this.lastPublishedStatus.get(manifest.id) === task.status) return;
    this.lastPublishedStatus.set(manifest.id, task.status);
    this.addEvent(manifest.id, task.status, this.lifecycleMessage(task.status));
    this.taskEvents.publish({ kind: "task", task });
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
    const events = this.eventsByRun.get(runId) ?? [];
    events.push(event);
    if (events.length > 200) events.splice(0, events.length - 200);
    this.eventsByRun.set(runId, events);
    const session = this.queue.get(runId)?.session;
    session?.recordLog({
      level: type.includes("failed") ? "error" : "info",
      message,
      itemId: itemId ?? null,
      timestamp: createdAt,
    });
    this.taskEvents.publishRealtime({
      id: event.id,
      taskId: runId,
      createdAt: event.createdAt,
      kind: "log",
      log: decorateTaskLog(event),
    });
    return event;
  }

  private async publishCommittedOutcome(
    manifest: ScrapeRunManifest,
    itemId: string,
    outcome: ScrapeItemOutcomeRecord,
  ): Promise<void> {
    const item = manifest.items.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error(`Scrape item not found in manifest: ${itemId}`);
    this.taskEvents.publishRealtime({
      id: `${outcome.id}:result:${outcome.completedAt.toISOString()}`,
      taskId: manifest.id,
      createdAt: outcome.completedAt.toISOString(),
      kind: "scrape-result",
      result: await this.outcomeToDto({ manifest, item, outcome }),
    });
  }

  private async toDto(runId: string): Promise<ScanTaskDto> {
    const live = this.queue.get(runId);
    const manifest =
      this.liveManifests.get(runId) ??
      (await (await this.persistence.getState()).repositories.scrapeRuns.getRun(runId));
    if (live) return this.liveTaskDto(manifest, live, live.session.snapshot());
    const summary = await (await this.persistence.getState()).repositories.scrapeRuns.getSummary(runId);
    return summary ? await this.historyTaskDto(manifest, summary) : await this.interruptedTaskDto(manifest);
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
          updatedAt: this.snapshotUpdatedAt.get(manifest.id) ?? manifest.createdAt,
          startedAt: entry.startedAt,
          completedAt: null,
          videoCount: successCount,
          directoryCount: 0,
          error: snapshot.error,
        },
        {
          rootDisplayName: this.rootDisplayNames.get(manifest.rootId) ?? "未知媒体目录",
          videos: manifest.items.map((item) => item.relativePath),
        },
      ),
      continuity: "live",
    };
  }

  private async historyTaskDto(manifest: ScrapeRunManifest, summary: ScrapeRunSummaryRecord): Promise<ScanTaskDto> {
    const rootDisplayName = await this.getRootDisplayName(manifest.rootId);
    return {
      ...toScanTaskDto(
        {
          id: manifest.id,
          kind: "scrape",
          rootId: manifest.rootId,
          status: summary.disposition === "completed" ? "completed" : "failed",
          createdAt: manifest.createdAt,
          updatedAt: summary.completedAt,
          startedAt: summary.startedAt,
          completedAt: summary.completedAt,
          videoCount: summary.successCount,
          directoryCount: 0,
          error: summary.error,
        },
        { rootDisplayName, videos: manifest.items.map((item) => item.relativePath) },
      ),
      continuity: "final",
    };
  }

  private async interruptedTaskDto(manifest: ScrapeRunManifest): Promise<ScanTaskDto> {
    const outcomes = await (await this.persistence.getState()).repositories.scrapeRuns.listLatestOutcomes(manifest.id);
    const successCount = outcomes.filter((outcome) => outcome.outcome === "success").length;
    return {
      ...toScanTaskDto(
        {
          id: manifest.id,
          kind: "scrape",
          rootId: manifest.rootId,
          status: "failed",
          createdAt: manifest.createdAt,
          updatedAt: manifest.createdAt,
          startedAt: null,
          completedAt: null,
          videoCount: successCount,
          directoryCount: 0,
          error: SCRAPE_BACKEND_INTERRUPTED_MESSAGE,
        },
        {
          rootDisplayName: await this.getRootDisplayName(manifest.rootId),
          videos: manifest.items.map((item) => item.relativePath),
        },
      ),
      continuity: "interrupted",
    };
  }

  private async outcomeToDto(context: OutcomeContext): Promise<ScrapeResultDto> {
    return toScrapeResultDto(context.outcome, context.item, {
      rootDisplayName: await this.getRootDisplayName(context.item.rootId),
      runCreatedAt: context.manifest.createdAt,
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
    const outcome = await repository.getOutcome(outcomeId);
    const manifest = await repository.getRun(outcome.runId);
    const item = manifest.items.find((candidate) => candidate.id === outcome.itemId);
    if (!item) throw new Error(`Scrape outcome item is missing from manifest: ${outcome.itemId}`);
    return { manifest, item, outcome };
  }

  private async buildAmbiguousUncensoredItems(runId: string): Promise<AmbiguousUncensoredItemDto[]> {
    const state = await this.persistence.getState();
    const manifest = await state.repositories.scrapeRuns.getRun(runId);
    const itemById = new Map(manifest.items.map((item) => [item.id, item]));
    const outcomes = await state.repositories.scrapeRuns.listLatestOutcomes(runId);
    return outcomes
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
    const cached = this.rootDisplayNames.get(rootId);
    if (cached) return cached;
    const root = await (await this.persistence.getState()).repositories.mediaRoots
      .get(rootId, { includeDeleted: true })
      .catch(() => null);
    const displayName = root?.displayName ?? "未知媒体目录";
    this.rootDisplayNames.set(rootId, displayName);
    return displayName;
  }

  private lifecycleMessage(status: ScanTaskDto["status"]): string {
    switch (status) {
      case "queued":
        return "Scrape task queued";
      case "running":
        return "Scrape task started";
      case "paused":
        return "Scrape task paused";
      case "stopping":
        return "Stopping scrape task";
      case "completed":
        return "Scrape task completed";
      case "failed":
        return "Scrape task failed";
    }
  }

  private scheduleScrapeInvalidation(): void {
    if (this.scrapeInvalidationTimer) return;
    this.scrapeInvalidationTimer = setTimeout(() => {
      this.scrapeInvalidationTimer = null;
      this.taskEvents.publish({ kind: "scrape-invalidated" });
    }, 250);
  }

  private retainTerminalSnapshots(): void {
    const terminalRunIds = [...this.snapshots.entries()]
      .filter(([runId, snapshot]) => !this.queue.get(runId) && isTerminalSnapshot(snapshot))
      .map(([runId]) => runId);
    while (terminalRunIds.length > TERMINAL_SNAPSHOT_LIMIT) {
      const runId = terminalRunIds.shift();
      if (!runId) break;
      this.snapshots.delete(runId);
      this.snapshotUpdatedAt.delete(runId);
      this.eventsByRun.delete(runId);
      this.lastPublishedStatus.delete(runId);
    }
  }
}
