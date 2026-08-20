import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { type MediaRoot, resolveRootRelativePath, toRootRelativePath } from "@mdcz/media-store";
import type { ScrapeResultRecord, TaskRecord, TaskRecordStatus } from "@mdcz/persistence";
import { toLibraryAssets } from "@mdcz/runtime/library";
import { buildMovieTags, LocalScanService } from "@mdcz/runtime/maintenance";
import { MaintenanceArtifactResolver } from "@mdcz/runtime/maintenance/MaintenanceArtifactResolver";
import { NetworkClient } from "@mdcz/runtime/network";
import {
  applyScrapeNetworkPolicy,
  confirmUncensoredOutputs,
  createScrapeExecutionPolicy,
  FileOrganizer,
  type MountedRootScrapeRuntime,
  NfoGenerator,
  PosterCropService,
  runScrapeItems,
} from "@mdcz/runtime/scrape";
import { runtimeLoggerService } from "@mdcz/runtime/shared";
import {
  type RuntimeTaskAction,
  RuntimeTaskQueueRunner,
  resolveRecoverableSession as resolveRuntimeRecoverableSession,
  summarizeRecoverableSession,
  toRuntimeTaskSnapshot,
  toServerTaskStatus,
  transitionTask,
} from "@mdcz/runtime/tasks";
import type { TranslationMappingStore } from "@mdcz/runtime/translate";
import { validateManualScrapeUrl } from "@mdcz/shared/manualScrapeUrl";
import type {
  AmbiguousUncensoredItemDto,
  FileActionInput,
  FileActionResponse,
  LogListResponse,
  NfoReadInput,
  NfoReadResponse,
  NfoWriteInput,
  NfoWriteResponse,
  PosterCropSaveInput,
  PosterCropSessionResponse,
  ScanTaskDetailResponse,
  ScanTaskDto,
  ScanTaskListResponse,
  ScrapeConfirmUncensoredInput,
  ScrapeRecoverableSessionResolveInput,
  ScrapeRecoverableSessionResolveResponse,
  ScrapeRecoverableSessionResponse,
  ScrapeResultDetailResponse,
  ScrapeResultDto,
  ScrapeResultListResponse,
  ScrapeStartInput,
  ScrapeStartSelectedFilesInput,
  ScrapeTaskControlInput,
  TaskEventDto,
  TaskEventListResponse,
} from "@mdcz/shared/serverDtos";
import type { UncensoredChoice } from "@mdcz/shared/types";
import { toRootRelativeAssetPath, toScrapeResultDto } from "../scrapeDtos";
import { createServerScrapeRuntime } from "../scrapeRuntimeFactory";
import { toScanTaskDto, toTaskEventDto } from "../taskDto";
import type { TaskEventBus } from "../taskEvents";
import type { ServerConfigService } from "./configService";
import type { MediaRootService } from "./mediaRootService";
import type { ServerPersistenceService } from "./persistenceService";
import { decorateTaskLog } from "./runtimeLogService";
import { ServerNfoAdapter, ServerPosterCropAdapter } from "./scrapeAdapters";

const recoverableTaskStatuses = new Set<TaskRecordStatus>(["queued", "running", "paused", "stopping", "failed"]);
const recoverableResultStatuses = new Set<ScrapeResultRecord["status"]>(["pending", "processing", "failed"]);

export class ScrapeService {
  #stopRequested = new Set<string>();
  #paused = new Set<string>();
  #pauseGates = new Map<string, { promise: Promise<void>; release: () => void }>();
  #controllers = new Map<string, AbortController>();
  #uncensoredConfirmedTasks = new Set<string>();
  #uncensoredChoices = new Map<string, Map<string, UncensoredChoice>>();
  private readonly networkClient = new NetworkClient();
  private readonly fileOrganizer = new FileOrganizer();
  private readonly nfoGenerator = new NfoGenerator();
  private readonly posterCropService = new PosterCropService();
  private readonly nfoAdapter: ServerNfoAdapter;
  private readonly posterCropAdapter: ServerPosterCropAdapter;
  private readonly runtime: MountedRootScrapeRuntime;
  private readonly runner: RuntimeTaskQueueRunner<TaskRecord>;

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
    this.runner = new RuntimeTaskQueueRunner({
      getNextTask: async () => await (await this.persistence.getState()).repositories.tasks.nextQueued("scrape"),
      runTask: async (task) => {
        await this.runTask(task.id);
      },
    });
  }

  async start(
    input: ScrapeStartInput,
    options?: { uncensoredChoices?: Map<string, UncensoredChoice> },
  ): Promise<ScanTaskDto> {
    const firstRootId = input.refs[0].rootId;
    const task = await (await this.persistence.getState()).repositories.tasks.createTask({
      kind: "scrape",
      rootId: firstRootId,
    });
    if (input.uncensoredConfirmed === true) {
      this.#uncensoredConfirmedTasks.add(task.id);
    }
    const inputChoices =
      options?.uncensoredChoices ??
      new Map(input.refs.map((ref) => [`${ref.rootId}:${ref.relativePath}`, "uncensored" as const]));
    for (const ref of input.refs) {
      await this.mediaRoots.getActiveRoot(ref.rootId);
      await this.upsertPendingResult(task.id, ref.rootId, ref.relativePath, input.manualUrl ?? null);
    }
    if (input.uncensoredConfirmed === true) {
      this.#uncensoredChoices.set(task.id, inputChoices);
    }
    await this.addEvent(task.id, "queued", `Scrape task queued. Files: ${input.refs.length}`);
    this.taskEvents.publish({ kind: "task", task: await this.toDto(task.id) });
    this.drain();
    return await this.toDto(task.id);
  }

  async startSelectedFiles(input: ScrapeStartSelectedFilesInput): Promise<ScanTaskDto> {
    if (!input.scanDir) {
      throw new Error("scanDir is required when starting selected host files");
    }
    const normalizedScanDir = path.resolve(input.scanDir);
    const configuredMediaPath = (await this.config.get()).paths.mediaPath.trim();
    if (!configuredMediaPath) {
      throw new Error("媒体目录未配置");
    }
    const configuredRoot = await this.mediaRoots.syncSingleEnabledRoot({
      displayName: path.basename(path.resolve(configuredMediaPath)) || path.resolve(configuredMediaPath),
      hostPath: configuredMediaPath,
      enabled: true,
    });
    const roots = [configuredRoot];
    const refs = [];
    for (const filePath of input.filePaths) {
      const resolvedPath = path.resolve(filePath);
      const relativeToScan = path.relative(normalizedScanDir, resolvedPath);
      if (!relativeToScan || relativeToScan.startsWith("..") || path.isAbsolute(relativeToScan)) {
        throw new Error(`文件不在扫描目录内：${filePath}`);
      }
      const root = roots.find((candidate) => {
        const relativeToRoot = path.relative(candidate.hostPath, resolvedPath);
        return relativeToRoot && !relativeToRoot.startsWith("..") && !path.isAbsolute(relativeToRoot);
      });
      if (!root) {
        throw new Error(`文件不在已注册媒体目录内：${filePath}`);
      }
      const relativeToRoot = path.relative(root.hostPath, resolvedPath);
      refs.push({
        rootId: root.id,
        relativePath: relativeToRoot.replace(/\\/gu, "/"),
      });
    }

    return await this.start({
      refs,
      manualUrl: input.manualUrl,
      uncensoredConfirmed: input.uncensoredConfirmed,
    });
  }

  async list(): Promise<ScanTaskListResponse> {
    const tasks = await (await this.persistence.getState()).repositories.tasks.list("scrape");
    return { tasks: await Promise.all(tasks.map((task) => this.toDto(task.id))) };
  }

  async detail(taskId: string): Promise<ScanTaskDetailResponse> {
    return { task: await this.toDto(taskId), events: (await this.events(taskId)).events };
  }

  async events(taskId: string): Promise<TaskEventListResponse> {
    const events = await (await this.persistence.getState()).repositories.tasks.listEvents(taskId);
    return { events: events.map(toTaskEventDto) };
  }

  async logs(): Promise<LogListResponse> {
    const state = await this.persistence.getState();
    const tasks = await state.repositories.tasks.list("scrape");
    const events = await Promise.all(tasks.map((task) => state.repositories.tasks.listEvents(task.id)));
    const logs = events
      .flat()
      .map((event) => ({ ...toTaskEventDto(event), source: "task" as const }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return { logs };
  }

  async listResults(input?: ScrapeTaskControlInput): Promise<ScrapeResultListResponse> {
    const state = await this.persistence.getState();
    const records = await state.repositories.library.listScrapeResults(input?.taskId);
    return { results: await Promise.all(records.map((record) => this.resultToDto(record))) };
  }

  async result(id: string): Promise<ScrapeResultDetailResponse> {
    const record = await (await this.persistence.getState()).repositories.library.getScrapeResult(id);
    return { result: await this.resultToDto(record) };
  }

  async stop(input: ScrapeTaskControlInput): Promise<ScanTaskDto> {
    if (this.#controllers.has(input.taskId)) {
      this.#stopRequested.add(input.taskId);
      this.#controllers.get(input.taskId)?.abort();
    }
    this.#paused.delete(input.taskId);
    this.releasePauseGate(input.taskId);
    await this.transitionTask(input.taskId, "stop", "刮削已停止");
    await this.addEvent(input.taskId, "stopping", "Stopping scrape task");
    this.taskEvents.publish({ kind: "task", task: await this.toDto(input.taskId) });
    return await this.toDto(input.taskId);
  }

  async close(): Promise<void> {
    this.runner.requestStop();
    for (const taskId of this.#pauseGates.keys()) this.releasePauseGate(taskId);
    for (const controller of this.#controllers.values()) {
      controller.abort();
    }
    await this.runner.waitForIdle();
  }

  async pause(input: ScrapeTaskControlInput): Promise<ScanTaskDto> {
    this.#paused.add(input.taskId);
    if (this.#controllers.has(input.taskId)) this.getPauseGate(input.taskId);
    await this.transitionTask(input.taskId, "pause");
    await this.addEvent(input.taskId, "paused", "Scrape task paused");
    this.taskEvents.publish({ kind: "task", task: await this.toDto(input.taskId) });
    return await this.toDto(input.taskId);
  }

  async resume(input: ScrapeTaskControlInput): Promise<ScanTaskDto> {
    const isActive = this.#controllers.has(input.taskId);
    this.#paused.delete(input.taskId);
    await this.transitionTask(input.taskId, "resume");
    if (isActive) await this.transitionTask(input.taskId, "start");
    this.releasePauseGate(input.taskId);
    await this.addEvent(input.taskId, isActive ? "running" : "queued", "Scrape task resumed");
    this.taskEvents.publish({ kind: "task", task: await this.toDto(input.taskId) });
    if (!isActive) this.drain();
    return await this.toDto(input.taskId);
  }

  async retry(input: ScrapeTaskControlInput): Promise<ScanTaskDto> {
    const state = await this.persistence.getState();
    const task = await state.repositories.tasks.get(input.taskId);
    if (task.status === "running" || task.status === "queued") {
      throw new Error("Only completed, failed, paused, or stopped scrape tasks can be retried");
    }
    this.#paused.delete(input.taskId);
    this.#stopRequested.delete(input.taskId);
    const results = await state.repositories.library.listScrapeResults(input.taskId);
    await state.repositories.library.deleteEntriesForTask(input.taskId);
    for (const result of results) {
      await state.repositories.library.upsertScrapeResult({
        id: result.id,
        taskId: result.taskId,
        rootId: result.rootId,
        relativePath: result.relativePath,
        status: "pending",
        manualUrl: result.manualUrl,
        uncensoredAmbiguous: false,
      });
    }
    const next = transitionTask(toRuntimeTaskSnapshot(task), { action: "retry" });
    await state.repositories.tasks.patch(input.taskId, {
      status: toServerTaskStatus(next.status),
      startedAt: next.startedAt,
      completedAt: next.completedAt,
      videoCount: 0,
      directoryCount: 0,
      error: next.error,
    });
    await this.addEvent(input.taskId, "queued", "Scrape retry queued");
    this.taskEvents.publish({ kind: "task", task: await this.toDto(input.taskId) });
    this.drain();
    return await this.toDto(input.taskId);
  }

  async confirmUncensored(input: ScrapeConfirmUncensoredInput): Promise<ScanTaskDto> {
    const state = await this.persistence.getState();
    const task = await state.repositories.tasks.get(input.taskId);
    if (task.kind !== "scrape") {
      throw new Error(`Task is not a scrape task: ${input.taskId}`);
    }

    const results = await state.repositories.library.listScrapeResults(input.taskId);
    const resultByRef = new Map(results.map((result) => [`${result.rootId}:${result.relativePath}`, result]));
    const selectedItems =
      input.items ??
      input.refs?.map((ref) => ({
        ref,
        choice: "uncensored" as const,
      })) ??
      [];
    const selectedResults = selectedItems.map((item) => {
      const ref = item.ref;
      const result = resultByRef.get(`${ref.rootId}:${ref.relativePath}`);
      if (!result) {
        throw new Error(`Ref does not belong to scrape task: ${ref.rootId}:${ref.relativePath}`);
      }
      if (result.status !== "success") {
        throw new Error(`Ref does not belong to successful scrape output: ${ref.rootId}:${ref.relativePath}`);
      }
      return { item, result };
    });
    if (selectedResults.length === 0) {
      throw new Error("No uncensored confirmation refs provided");
    }

    const configuration = await this.config.get();
    const roots = new Map<string, MediaRoot>();
    for (const { result } of selectedResults) {
      if (!roots.has(result.rootId)) roots.set(result.rootId, await this.mediaRoots.getActiveRoot(result.rootId));
      const nfoRootId = result.nfoRootId ?? result.rootId;
      if (!roots.has(nfoRootId)) roots.set(nfoRootId, await this.mediaRoots.getActiveRoot(nfoRootId));
    }
    const confirmation = await confirmUncensoredOutputs(
      selectedResults.map(({ item, result }) => {
        const root = roots.get(result.rootId) as MediaRoot;
        const nfoRoot = roots.get(result.nfoRootId ?? result.rootId) as MediaRoot;
        return {
          fileId: `${result.rootId}:${result.relativePath}`,
          videoPath: resolveRootRelativePath(root, result.outputRelativePath ?? result.relativePath),
          metadataVideoPath: result.nfoRootId
            ? resolveRootRelativePath(nfoRoot, this.resolveMetadataVideoPath(result))
            : undefined,
          nfoPath: result.nfoRelativePath ? resolveRootRelativePath(nfoRoot, result.nfoRelativePath) : undefined,
          crawlerData: result.crawlerDataJson ? JSON.parse(result.crawlerDataJson) : undefined,
          choice: item.choice,
        };
      }),
      configuration,
      {
        artifactResolver: new MaintenanceArtifactResolver(),
        fileOrganizer: this.fileOrganizer,
        localScanService: new LocalScanService(),
        logger: runtimeLoggerService.getLogger(`scrape-confirm:${task.id}`),
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

    const updatedBySource = new Map(confirmation.items.map((item) => [item.sourceVideoPath, item]));
    for (const { result } of selectedResults) {
      const root = roots.get(result.rootId) as MediaRoot;
      const metadataRoot = await this.resolveMetadataRoot(root);
      const sourceVideoPath = resolveRootRelativePath(root, result.outputRelativePath ?? result.relativePath);
      const updated = updatedBySource.get(sourceVideoPath);
      if (!updated) {
        await this.addEvent(task.id, "item-failed", `Uncensored confirmation skipped: ${result.relativePath}`);
        continue;
      }
      const outputRelativePath = toRootRelativeAssetPath(root, updated.targetVideoPath);
      const nfoRelativePath = toRootRelativeAssetPath(metadataRoot, updated.targetNfoPath);
      if (!outputRelativePath) throw new Error(`Confirmed output escaped media root: ${updated.targetVideoPath}`);
      const stored = await state.repositories.library.upsertScrapeResult({
        ...result,
        status: "success",
        error: null,
        outputRelativePath,
        nfoRootId: nfoRelativePath && metadataRoot.id !== root.id ? metadataRoot.id : null,
        nfoRelativePath,
        uncensoredAmbiguous: false,
      });
      const entry = await state.repositories.library.getEntry(
        result.rootId,
        result.outputRelativePath ?? result.relativePath,
      );
      const fileStats = await stat(updated.targetVideoPath);
      await state.repositories.library.relinkEntry({
        id: entry.id,
        rootId: result.rootId,
        rootRelativePath: outputRelativePath,
        size: fileStats.size,
        modifiedAt: fileStats.mtime,
      });
      await state.repositories.library.upsertEntry({
        id: entry.id,
        rootId: result.rootId,
        rootRelativePath: outputRelativePath,
        mediaIdentity: entry.mediaIdentity,
        size: fileStats.size,
        modifiedAt: fileStats.mtime,
        sourceTaskId: entry.sourceTaskId,
        scrapeOutputId: entry.scrapeOutputId,
        title: entry.title,
        number: entry.number,
        actors: entry.actors,
        crawlerDataJson: entry.crawlerDataJson,
        thumbnailPath: toRootRelativeAssetPath(metadataRoot, updated.assets.poster ?? updated.assets.thumb),
        assets: toLibraryAssets(metadataRoot, { ...updated.assets, downloaded: [] }),
        lastKnownPath: outputRelativePath,
        createdAt: entry.createdAt,
        lastRefreshedAt: new Date(),
      });
      this.taskEvents.publishRealtime({
        id: `${stored.id}:result:${stored.updatedAt.toISOString()}`,
        taskId: task.id,
        createdAt: stored.updatedAt.toISOString(),
        kind: "scrape-result",
        result: await this.resultToDto(stored),
      });
      await this.addEvent(task.id, "item-success", `Uncensored confirmation applied: ${outputRelativePath}`);
    }
    this.taskEvents.publish({ kind: "task", task: await this.toDto(task.id) });
    return await this.toDto(task.id);
  }

  async getRecoverableSession(): Promise<ScrapeRecoverableSessionResponse> {
    const recoverable = await this.findRecoverableTask();
    if (!recoverable) {
      return { ...summarizeRecoverableSession({}), taskId: null };
    }

    const summary = summarizeRecoverableSession({
      pendingCount: recoverable.results.filter(
        (result) => result.status === "pending" || result.status === "processing",
      ).length,
      failedCount: recoverable.results.filter((result) => result.status === "failed").length,
    });
    return { ...summary, taskId: recoverable.task.id };
  }

  async resolveRecoverableSession(
    input?: ScrapeRecoverableSessionResolveInput,
  ): Promise<ScrapeRecoverableSessionResolveResponse> {
    return await resolveRuntimeRecoverableSession(
      {
        summarize: async () => await this.getRecoverableSession(),
        recover: async () => await this.recoverSession(),
        discard: async () => {
          await this.discardRecoverableSession();
        },
      },
      {
        action: input?.action,
        discardMessage: "已放弃上次未完成的刮削任务",
        recoverMessage: "恢复任务已启动",
      },
    );
  }

  async recoverSession(): Promise<ScanTaskDto> {
    const recoverable = await this.findRecoverableTask();
    if (!recoverable) {
      throw new Error("No recoverable scrape session found");
    }

    const state = await this.persistence.getState();
    this.#paused.delete(recoverable.task.id);
    this.#stopRequested.delete(recoverable.task.id);
    for (const result of recoverable.results) {
      await state.repositories.library.upsertScrapeResult({
        ...result,
        status: "pending",
        error: null,
      });
    }
    await state.repositories.library.deleteEntriesForTask(recoverable.task.id);
    await state.repositories.tasks.patch(recoverable.task.id, {
      status: "queued",
      startedAt: null,
      completedAt: null,
      videoCount: 0,
      directoryCount: 0,
      error: null,
    });
    await this.addEvent(recoverable.task.id, "queued", "恢复未完成刮削并重新排队");
    this.taskEvents.publish({ kind: "task", task: await this.toDto(recoverable.task.id) });
    this.drain();
    return await this.toDto(recoverable.task.id);
  }

  async discardRecoverableSession(): Promise<void> {
    const recoverable = await this.findRecoverableTask();
    if (!recoverable) {
      return;
    }

    const state = await this.persistence.getState();
    this.#paused.delete(recoverable.task.id);
    this.#stopRequested.delete(recoverable.task.id);
    this.#controllers.get(recoverable.task.id)?.abort();
    for (const result of recoverable.results) {
      await state.repositories.library.upsertScrapeResult({
        ...result,
        status: "skipped",
        error: "已放弃未完成刮削",
      });
    }
    await state.repositories.tasks.patch(recoverable.task.id, {
      status: "failed",
      completedAt: new Date(),
      error: "已放弃未完成刮削",
    });
    await this.addEvent(recoverable.task.id, "discarded", "已放弃未完成刮削任务");
    this.taskEvents.publish({ kind: "task", task: await this.toDto(recoverable.task.id) });
  }

  async resumeQueued(): Promise<void> {
    const state = await this.persistence.getState();
    await state.repositories.tasks.requeueRunning("scrape");
    this.drain();
  }

  async nfoRead(input: NfoReadInput): Promise<NfoReadResponse> {
    return await this.nfoAdapter.read(input);
  }

  async nfoWrite(input: NfoWriteInput): Promise<NfoWriteResponse> {
    return await this.nfoAdapter.write(input);
  }

  async posterCropSession(id: string): Promise<PosterCropSessionResponse> {
    const state = await this.persistence.getState();
    const record = await state.repositories.library.getScrapeResult(id);
    if (record.status !== "success" || !record.outputRelativePath) {
      throw new Error("Poster editing requires a successful scrape result with local output");
    }
    return await this.posterCropAdapter.session(record);
  }

  async posterCropSave(input: PosterCropSaveInput): Promise<PosterCropSessionResponse> {
    const state = await this.persistence.getState();
    const record = await state.repositories.library.getScrapeResult(input.id);
    if (record.status !== "success" || !record.outputRelativePath) {
      throw new Error("Poster editing requires a successful scrape result with local output");
    }
    return await this.posterCropAdapter.save(record, input);
  }

  async deleteFile(input: FileActionInput): Promise<FileActionResponse> {
    const root = await this.mediaRoots.getActiveRoot(input.rootId);
    await rm(resolveRootRelativePath(root, input.relativePath), { force: true });
    return { ok: true, rootId: input.rootId, relativePath: input.relativePath };
  }

  private drain(): void {
    this.runner.drain();
  }

  private async runTask(taskId: string): Promise<void> {
    const state = await this.persistence.getState();
    const controller = new AbortController();
    this.#controllers.set(taskId, controller);
    await this.transitionTask(taskId, "start");
    await this.addEvent(taskId, "running", "Scrape task started");
    this.taskEvents.publish({ kind: "task", task: await this.toDto(taskId) });

    try {
      const allResults = await state.repositories.library.listScrapeResults(taskId);
      // A resumed task re-enters here with its full result set. Only items that never reached a
      // terminal status still need work — without this filter a pause/resume cycle re-scrapes
      // everything the previous run already finished.
      const results = allResults.filter((result) => result.status === "pending" || result.status === "processing");
      const settledCount = allResults.length - results.length;
      const config = await this.config.get();
      applyScrapeNetworkPolicy(this.networkClient, config);
      const policy = createScrapeExecutionPolicy(config, { logger: console });
      const counters = {
        successCount: allResults.filter((result) => result.status === "success").length,
        failedCount: allResults.filter((result) => result.status === "failed").length,
        totalBytes: await this.totalBytesForSuccessfulResults(allResults),
      };
      let progressHighWater = allResults.length > 0 ? Math.round((settledCount / allResults.length) * 100) : 0;
      await runScrapeItems(
        results,
        {
          concurrency: policy.concurrency,
          signal: controller.signal,
          control: {
            isStopRequested: () => this.#stopRequested.has(taskId),
            isPaused: () => this.#paused.has(taskId),
            onPaused: async () => await this.getPauseGate(taskId).promise,
          },
        },
        (result, index) => ({
          item: result,
          index,
          run: async (signal) => {
            if (this.#stopRequested.has(taskId)) {
              throw new Error("刮削已停止");
            }
            if (this.#paused.has(taskId)) {
              await this.getPauseGate(taskId).promise;
              if (this.#stopRequested.has(taskId)) throw new Error("刮削已停止");
            }
            await policy.restGate?.waitBeforeStart(signal);
            const processingResult = await state.repositories.library.upsertScrapeResult({
              ...result,
              status: "processing",
            });
            const processingUpdatedAt = processingResult.updatedAt.toISOString();
            this.taskEvents.publishRealtime({
              id: `${processingResult.id}:processing:${processingUpdatedAt}`,
              taskId,
              createdAt: processingUpdatedAt,
              kind: "scrape-result",
              result: await this.resultToDto(processingResult),
            });
            try {
              const root = await this.mediaRoots.getActiveRoot(result.rootId);
              const runtimeResult = await this.runtime.scrape({
                root,
                relativePath: result.relativePath,
                manualScrape: this.resolveManualScrape(result.manualUrl),
                progress: { fileIndex: settledCount + index + 1, totalFiles: allResults.length },
                localState: this.resolveConfirmedLocalState(taskId, result),
                signal,
                onEvent: async (type, message) => {
                  await this.addEvent(taskId, type, message);
                },
                onProgress: ({ value, current, total }) => {
                  progressHighWater = Math.max(progressHighWater, value);
                  const createdAt = new Date().toISOString();
                  this.taskEvents.publishRealtime({
                    id: `${processingResult.id}:progress:${current}:${progressHighWater}:${createdAt}`,
                    taskId,
                    createdAt,
                    kind: "task-progress",
                    taskKind: "scrape",
                    value: progressHighWater,
                    current,
                    total,
                    message: result.relativePath,
                  });
                },
                onStage: (stage, message) => {
                  const createdAt = new Date().toISOString();
                  this.taskEvents.publishRealtime({
                    id: `${processingResult.id}:stage:${stage}:${createdAt}`,
                    taskId,
                    createdAt,
                    kind: "scrape-stage",
                    stage,
                    message,
                    relativePath: result.relativePath,
                  });
                },
              });
              await this.persistRuntimeResult(taskId, result, root, runtimeResult, counters);
            } catch (error) {
              if (this.#stopRequested.has(taskId)) {
                throw error;
              }
              const message = error instanceof Error ? error.message : String(error);
              await this.persistUnexpectedItemFailure(taskId, result, message, counters);
              const overallIndex = settledCount + index + 1;
              progressHighWater = Math.max(progressHighWater, Math.round((overallIndex / allResults.length) * 100));
              const createdAt = new Date().toISOString();
              this.taskEvents.publishRealtime({
                id: `${processingResult.id}:progress:${overallIndex}:${progressHighWater}:${createdAt}`,
                taskId,
                createdAt,
                kind: "task-progress",
                taskKind: "scrape",
                value: progressHighWater,
                current: overallIndex,
                total: allResults.length,
                message: result.relativePath,
              });
            }
          },
        }),
      );
      if (this.#stopRequested.has(taskId)) {
        throw new Error("刮削已停止");
      }
      // A pause/resume/stop can land while this run is finishing its last item. The persisted
      // status is the authority: if it already moved off "running", the queue owns the task now
      // and completing it here would be an illegal transition.
      if ((await state.repositories.tasks.get(taskId)).status !== "running") {
        return;
      }
      this.#paused.delete(taskId);
      const output = await state.repositories.library.upsertScrapeOutput({
        taskId,
        rootId: allResults[0]?.rootId ?? null,
        outputDirectory: null,
        fileCount: counters.successCount,
        totalBytes: counters.totalBytes,
        completedAt: new Date(),
      });
      const allFilesFailed = counters.failedCount > 0 && counters.successCount === 0;
      const next = transitionTask(toRuntimeTaskSnapshot(await state.repositories.tasks.get(taskId)), {
        action: allFilesFailed ? "fail" : "complete",
        error: allFilesFailed ? "All files failed to scrape" : null,
      });
      await state.repositories.tasks.patch(taskId, {
        status: toServerTaskStatus(next.status),
        completedAt: next.completedAt,
        videoCount: counters.successCount,
        directoryCount: 0,
        error: next.error,
      });
      const completedEvent = await this.addEvent(
        taskId,
        allFilesFailed ? "failed" : "completed",
        allFilesFailed
          ? `Scrape failed. Succeeded: ${counters.successCount}, Failed: ${counters.failedCount}, Output: ${output.id}`
          : `Scrape completed. Succeeded: ${counters.successCount}, Failed: ${counters.failedCount}, Output: ${output.id}`,
        { publish: false },
      );
      const ambiguousUncensoredItems = await this.buildAmbiguousUncensoredItems(taskId);
      this.taskEvents.publish({
        kind: "event",
        event: completedEvent,
        ...(ambiguousUncensoredItems.length > 0 ? { ambiguousUncensoredItems } : {}),
      });
      this.taskEvents.publish({ kind: "task", task: await this.toDto(taskId) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const currentTask = await state.repositories.tasks.get(taskId);
      if (currentTask.status !== "failed" && currentTask.status !== "completed") {
        await this.transitionTask(taskId, "fail", message);
        await this.addEvent(taskId, "failed", message);
        this.taskEvents.publish({ kind: "task", task: await this.toDto(taskId) });
      }
    } finally {
      this.releasePauseGate(taskId);
      this.#controllers.delete(taskId);
      this.#stopRequested.delete(taskId);
      this.#uncensoredConfirmedTasks.delete(taskId);
      this.#uncensoredChoices.delete(taskId);
    }
  }

  private async upsertPendingResult(
    taskId: string,
    rootId: string,
    relativePath: string,
    manualUrl: string | null,
  ): Promise<void> {
    await (await this.persistence.getState()).repositories.library.upsertScrapeResult({
      taskId,
      rootId,
      relativePath,
      status: "pending",
      manualUrl,
    });
  }

  private async persistRuntimeResult(
    taskId: string,
    result: ScrapeResultRecord,
    root: MediaRoot,
    runtimeResult: Awaited<ReturnType<MountedRootScrapeRuntime["scrape"]>>,
    counters: { successCount: number; failedCount: number; totalBytes: number },
  ): Promise<void> {
    const state = await this.persistence.getState();
    if (this.#stopRequested.has(taskId)) {
      await state.repositories.library.upsertScrapeResult({
        ...result,
        status: "skipped",
        error: "刮削已停止",
      });
      throw new Error("刮削已停止");
    }
    if (runtimeResult.status !== "success") {
      counters.failedCount += 1;
      const failedResult = await state.repositories.library.upsertScrapeResult({
        ...result,
        status: "failed",
        error: runtimeResult.error,
      });
      this.taskEvents.publishRealtime({
        id: `${failedResult.id}:result:${failedResult.updatedAt.toISOString()}`,
        taskId,
        createdAt: failedResult.updatedAt.toISOString(),
        kind: "scrape-result",
        result: await this.resultToDto(failedResult),
      });
      await this.addEvent(taskId, "item-failed", `${result.relativePath}: ${runtimeResult.error}`);
      return;
    }

    const metadataRoot = await this.resolveMetadataRoot(root);
    const nfoRelativePath = runtimeResult.nfoPath ? toRootRelativePath(metadataRoot, runtimeResult.nfoPath) : null;
    const thumbnailPath = toRootRelativeAssetPath(
      metadataRoot,
      runtimeResult.result.assets?.poster ?? runtimeResult.result.assets?.thumb,
    );
    const libraryAssets = toLibraryAssets(metadataRoot, runtimeResult.result.assets);
    const stored = await state.repositories.library.upsertScrapeResult({
      id: result.id,
      taskId,
      rootId: result.rootId,
      relativePath: result.relativePath,
      status: "success",
      crawlerDataJson: JSON.stringify(runtimeResult.crawlerData),
      nfoRootId: nfoRelativePath && metadataRoot.id !== root.id ? metadataRoot.id : null,
      nfoRelativePath,
      outputRelativePath: runtimeResult.outputRelativePath,
      manualUrl: result.manualUrl,
      uncensoredAmbiguous: this.#uncensoredConfirmedTasks.has(taskId)
        ? false
        : (runtimeResult.result.uncensoredAmbiguous ?? false),
    });
    counters.totalBytes += runtimeResult.size;
    await state.repositories.library.upsertEntry({
      rootId: result.rootId,
      rootRelativePath: runtimeResult.outputRelativePath,
      mediaIdentity: runtimeResult.crawlerData.number,
      size: runtimeResult.size,
      modifiedAt: runtimeResult.modifiedAt,
      sourceTaskId: taskId,
      scrapeOutputId: stored.id,
      title: runtimeResult.crawlerData.title,
      number: runtimeResult.crawlerData.number,
      actors: runtimeResult.crawlerData.actors,
      crawlerDataJson: JSON.stringify(runtimeResult.crawlerData),
      thumbnailPath:
        thumbnailPath ?? runtimeResult.crawlerData.thumb_url ?? runtimeResult.crawlerData.poster_url ?? null,
      assets: libraryAssets,
      lastKnownPath: runtimeResult.outputRelativePath,
    });
    counters.successCount += 1;
    this.taskEvents.publishRealtime({
      id: `${stored.id}:result:${stored.updatedAt.toISOString()}`,
      taskId,
      createdAt: stored.updatedAt.toISOString(),
      kind: "scrape-result",
      result: await this.resultToDto(stored),
    });
    await this.addEvent(taskId, "item-success", `Generated NFO: ${nfoRelativePath ?? "not generated"}`);
  }

  private async totalBytesForSuccessfulResults(results: readonly ScrapeResultRecord[]): Promise<number> {
    const sizes = await Promise.all(
      results.map(async (result) => {
        if (result.status !== "success" || !result.outputRelativePath) return 0;
        const root = await this.mediaRoots.getActiveRoot(result.rootId).catch(() => null);
        if (!root) return 0;
        return (await stat(resolveRootRelativePath(root, result.outputRelativePath)).catch(() => null))?.size ?? 0;
      }),
    );
    return sizes.reduce((total, size) => total + size, 0);
  }

  private getPauseGate(taskId: string): { promise: Promise<void>; release: () => void } {
    const existing = this.#pauseGates.get(taskId);
    if (existing) return existing;
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gate = { promise, release };
    this.#pauseGates.set(taskId, gate);
    return gate;
  }

  private releasePauseGate(taskId: string): void {
    const gate = this.#pauseGates.get(taskId);
    if (!gate) return;
    this.#pauseGates.delete(taskId);
    gate.release();
  }

  private async persistUnexpectedItemFailure(
    taskId: string,
    result: ScrapeResultRecord,
    message: string,
    counters: { successCount: number; failedCount: number; totalBytes: number },
  ): Promise<void> {
    const state = await this.persistence.getState();
    counters.failedCount += 1;
    const failedResult = await state.repositories.library.upsertScrapeResult({
      ...result,
      status: "failed",
      error: message,
    });
    this.taskEvents.publishRealtime({
      id: `${failedResult.id}:result:${failedResult.updatedAt.toISOString()}`,
      taskId,
      createdAt: failedResult.updatedAt.toISOString(),
      kind: "scrape-result",
      result: await this.resultToDto(failedResult),
    });
    await this.addEvent(taskId, "item-failed", `${result.relativePath}: ${message}`);
  }

  private async findRecoverableTask(): Promise<{ task: TaskRecord; results: ScrapeResultRecord[] } | null> {
    const state = await this.persistence.getState();
    const tasks = await state.repositories.tasks.list("scrape");
    for (const task of tasks) {
      if (!recoverableTaskStatuses.has(task.status)) {
        continue;
      }

      const results = await state.repositories.library.listScrapeResults(task.id);
      const recoverableResults = results.filter((result) => recoverableResultStatuses.has(result.status));
      if (recoverableResults.length > 0) {
        return { task, results: recoverableResults };
      }
    }
    return null;
  }

  private async toDto(taskId: string): Promise<ScanTaskDto> {
    const state = await this.persistence.getState();
    const task = await state.repositories.tasks.get(taskId);
    const root = await state.repositories.mediaRoots.get(task.rootId, { includeDeleted: true }).catch(() => null);
    const results = await state.repositories.library.listScrapeResults(taskId);
    return toScanTaskDto(task, {
      rootDisplayName: root?.displayName ?? "未知媒体目录",
      videoCount: task.videoCount,
      videos: results.map((result) => result.relativePath),
    });
  }

  private async transitionTask(taskId: string, action: RuntimeTaskAction, error?: string | null): Promise<void> {
    const state = await this.persistence.getState();
    const task = await state.repositories.tasks.get(taskId);
    const next = transitionTask(toRuntimeTaskSnapshot(task), { action, error });
    await state.repositories.tasks.patch(taskId, {
      status: toServerTaskStatus(next.status),
      startedAt: next.startedAt,
      completedAt: next.completedAt,
      error: next.error,
    });
  }

  private async resultToDto(record: ScrapeResultRecord): Promise<ScrapeResultDto> {
    const root = await (await this.persistence.getState()).repositories.mediaRoots
      .get(record.rootId, { includeDeleted: true })
      .catch(() => null);
    return toScrapeResultDto(record, { rootDisplayName: root?.displayName ?? "未知媒体目录" });
  }

  private async buildAmbiguousUncensoredItems(taskId: string): Promise<AmbiguousUncensoredItemDto[]> {
    const records = await (await this.persistence.getState()).repositories.library.listScrapeResults(taskId);
    return records
      .filter((record) => record.uncensoredAmbiguous)
      .filter((record) => record.status === "success")
      .map((record) => {
        const crawlerData = record.crawlerDataJson ? JSON.parse(record.crawlerDataJson) : null;
        const number =
          typeof crawlerData?.number === "string" && crawlerData.number.trim()
            ? crawlerData.number
            : path.posix.basename(record.relativePath, path.posix.extname(record.relativePath));
        const title =
          typeof crawlerData?.title_zh === "string" && crawlerData.title_zh.trim()
            ? crawlerData.title_zh
            : typeof crawlerData?.title === "string" && crawlerData.title.trim()
              ? crawlerData.title
              : null;
        return {
          id: record.id,
          ref: {
            rootId: record.rootId,
            relativePath: record.relativePath,
          },
          fileId: `${record.rootId}:${record.relativePath}`,
          fileName: path.posix.basename(record.relativePath),
          number,
          title,
          nfoRelativePath: record.nfoRelativePath,
        };
      });
  }

  private async addEvent(
    taskId: string,
    type: string,
    message: string,
    options: { publish?: boolean } = {},
  ): Promise<TaskEventDto> {
    const event = await (await this.persistence.getState()).repositories.tasks.addEvent({ taskId, type, message });
    const dto = toTaskEventDto(event);
    if (options.publish !== false) {
      this.taskEvents.publish({ kind: "event", event: dto });
    }
    this.taskEvents.publishRealtime({
      id: dto.id,
      taskId: dto.taskId,
      createdAt: dto.createdAt,
      kind: "log",
      log: decorateTaskLog(dto),
    });
    if (type === "failed") {
      this.taskEvents.publishRealtime({
        id: `${dto.id}:failed`,
        taskId: dto.taskId,
        createdAt: dto.createdAt,
        kind: "task-failed",
        message,
        error: message,
      });
    } else if (
      !["running", "queued", "paused", "stopping", "completed", "item-success", "item-failed", "log"].includes(type)
    ) {
      this.taskEvents.publishRealtime({
        id: `${dto.id}:stage`,
        taskId: dto.taskId,
        createdAt: dto.createdAt,
        kind: "scrape-stage",
        stage: type,
        message,
      });
    }
    return dto;
  }

  private resolveManualScrape(
    manualUrl?: string | null,
  ): Parameters<MountedRootScrapeRuntime["scrape"]>[0]["manualScrape"] {
    const trimmed = manualUrl?.trim();
    if (!trimmed) {
      return undefined;
    }

    const validation = validateManualScrapeUrl(trimmed);
    if (!validation.valid) {
      throw new Error(validation.message);
    }
    return {
      site: validation.route.site,
      detailUrl: validation.route.detailUrl,
    };
  }

  private resolveConfirmedLocalState(taskId: string, result: ScrapeResultRecord) {
    const choice = this.#uncensoredChoices.get(taskId)?.get(`${result.rootId}:${result.relativePath}`);
    return choice ? { uncensoredChoice: choice } : undefined;
  }

  private async resolveMetadataRoot(primaryRoot: MediaRoot): Promise<MediaRoot> {
    const metadataPath = (await this.config.get()).paths.metadataPath.trim();
    return metadataPath ? await this.mediaRoots.ensureMetadataRoot(metadataPath) : primaryRoot;
  }

  private resolveMetadataVideoPath(result: ScrapeResultRecord): string {
    const outputRelativePath = result.outputRelativePath ?? result.relativePath;
    return result.nfoRootId
      ? path.posix.join(
          path.posix.dirname(outputRelativePath),
          `${path.posix.basename(outputRelativePath, path.posix.extname(outputRelativePath))}.strm`,
        )
      : outputRelativePath;
  }
}
