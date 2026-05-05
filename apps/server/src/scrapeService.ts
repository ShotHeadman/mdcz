import { rm } from "node:fs/promises";
import path from "node:path";
import type { ScrapeResultRecord, TaskRecord, TaskRecordStatus } from "@mdcz/persistence";
import { toLibraryAssets } from "@mdcz/runtime/library";
import { NetworkClient } from "@mdcz/runtime/network";
import {
  applyScrapeNetworkPolicy,
  createScrapeExecutionPolicy,
  type MountedRootScrapeRuntime,
  NfoGenerator,
  parseNfo,
  runScrapeItems,
} from "@mdcz/runtime/scrape";
import {
  type RuntimeTaskAction,
  RuntimeTaskQueueRunner,
  resolveRecoverableSession as resolveRuntimeRecoverableSession,
  summarizeRecoverableSession,
  toRuntimeTaskSnapshot,
  toServerTaskStatus,
  transitionTask,
} from "@mdcz/runtime/tasks";
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
import {
  atomicWriteRootFile,
  type MediaRoot,
  readRootFile,
  resolveRootRelativePath,
  StorageError,
  storageErrorCodes,
} from "@mdcz/storage";
import type { ServerConfigService } from "./configService";
import type { MediaRootService } from "./mediaRootService";
import type { ServerPersistenceService } from "./persistenceService";
import { toRootRelativeAssetPath, toScrapeResultDto } from "./scrapeDtos";
import { createServerScrapeRuntime } from "./scrapeRuntimeFactory";
import { toScanTaskDto, toTaskEventDto } from "./taskDto";
import type { TaskEventBus } from "./taskEvents";

const recoverableTaskStatuses = new Set<TaskRecordStatus>(["queued", "running", "paused", "stopping", "failed"]);
const recoverableResultStatuses = new Set<ScrapeResultRecord["status"]>(["pending", "processing", "failed"]);

export class ScrapeService {
  #stopRequested = new Set<string>();
  #paused = new Set<string>();
  #controllers = new Map<string, AbortController>();
  #uncensoredConfirmedTasks = new Set<string>();
  #uncensoredChoices = new Map<string, Map<string, UncensoredChoice>>();
  private readonly networkClient = new NetworkClient();
  private readonly nfoGenerator = new NfoGenerator();
  private readonly runtime: MountedRootScrapeRuntime;
  private readonly runner: RuntimeTaskQueueRunner<TaskRecord>;

  constructor(
    private readonly persistence: ServerPersistenceService,
    private readonly mediaRoots: MediaRootService,
    private readonly config: ServerConfigService,
    private readonly taskEvents: TaskEventBus,
    runtime?: MountedRootScrapeRuntime,
  ) {
    this.runtime = runtime ?? createServerScrapeRuntime(this.config, this.networkClient);
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
    await this.addEvent(task.id, "queued", `刮削任务已排队：${input.refs.length} 个文件`);
    this.taskEvents.publish({ kind: "task", task: await this.toDto(task.id) });
    this.drain();
    return await this.toDto(task.id);
  }

  async startSelectedFiles(input: ScrapeStartSelectedFilesInput): Promise<ScanTaskDto> {
    if (!input.scanDir) {
      throw new Error("scanDir is required when starting selected host files");
    }
    const normalizedScanDir = path.resolve(input.scanDir);
    const roots = (await this.mediaRoots.list()).roots.filter((root) => root.enabled);
    const refs = input.filePaths.map((filePath) => {
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
      const relative = path.relative(root.hostPath, resolvedPath);
      return {
        rootId: root.id,
        relativePath: relative.replace(/\\/gu, "/"),
      };
    });

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
    const tasks = (await this.list()).tasks;
    const events = await Promise.all(tasks.map((task) => this.events(task.id)));
    const logs = events
      .flatMap((eventList) => eventList.events)
      .map((event) => ({ ...event, source: "task" as const }))
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
    const task = await (await this.persistence.getState()).repositories.tasks.get(input.taskId);
    if (task.status === "running" || task.status === "stopping") {
      this.#stopRequested.add(input.taskId);
      this.#controllers.get(input.taskId)?.abort();
    }
    this.#paused.delete(input.taskId);
    await this.transitionTask(input.taskId, "stop", "刮削已停止");
    await this.addEvent(input.taskId, "stopping", "正在停止刮削任务");
    this.taskEvents.publish({ kind: "task", task: await this.toDto(input.taskId) });
    return await this.toDto(input.taskId);
  }

  async pause(input: ScrapeTaskControlInput): Promise<ScanTaskDto> {
    this.#paused.add(input.taskId);
    await this.transitionTask(input.taskId, "pause");
    await this.addEvent(input.taskId, "paused", "刮削任务已暂停");
    this.taskEvents.publish({ kind: "task", task: await this.toDto(input.taskId) });
    return await this.toDto(input.taskId);
  }

  async resume(input: ScrapeTaskControlInput): Promise<ScanTaskDto> {
    this.#paused.delete(input.taskId);
    await this.transitionTask(input.taskId, "resume");
    await this.addEvent(input.taskId, "queued", "刮削任务已恢复排队");
    this.taskEvents.publish({ kind: "task", task: await this.toDto(input.taskId) });
    this.drain();
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
    await this.addEvent(input.taskId, "queued", "重试刮削已排队");
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
    const choicesByRef = new Map(
      selectedItems.map((item) => [`${item.ref.rootId}:${item.ref.relativePath}`, item.choice]),
    );
    const refs = selectedItems.map((item) => {
      const ref = item.ref;
      const result = resultByRef.get(`${ref.rootId}:${ref.relativePath}`);
      if (!result) {
        throw new Error(`Ref does not belong to scrape task: ${ref.rootId}:${ref.relativePath}`);
      }
      return ref;
    });
    if (refs.length === 0) {
      throw new Error("No uncensored confirmation refs provided");
    }

    const newTask = await this.start(
      {
        refs,
        manualUrl: results.find((result) => result.manualUrl)?.manualUrl ?? undefined,
        uncensoredConfirmed: true,
      },
      { uncensoredChoices: choicesByRef },
    );
    return newTask;
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
    const root = await this.mediaRoots.getActiveRoot(input.rootId);
    const content = await readRootFile(root, input.relativePath).catch((error: unknown) => {
      if (error instanceof StorageError && error.code === storageErrorCodes.MissingPath) {
        return null;
      }
      throw error;
    });
    return {
      rootId: input.rootId,
      relativePath: input.relativePath,
      exists: content !== null,
      data: content === null ? null : parseNfo(content.toString("utf-8"), input.relativePath),
    };
  }

  async nfoWrite(input: NfoWriteInput): Promise<NfoWriteResponse> {
    const root = await this.mediaRoots.getActiveRoot(input.rootId);
    await atomicWriteRootFile(root, input.relativePath, this.nfoGenerator.buildXml(input.data));
    return { rootId: input.rootId, relativePath: input.relativePath, data: input.data };
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
    await this.addEvent(taskId, "running", "开始刮削媒体文件");
    this.taskEvents.publish({ kind: "task", task: await this.toDto(taskId) });

    try {
      const results = await state.repositories.library.listScrapeResults(taskId);
      const config = await this.config.get();
      applyScrapeNetworkPolicy(this.networkClient, config);
      const policy = createScrapeExecutionPolicy(config, { logger: console });
      const counters = { successCount: 0, failedCount: 0, totalBytes: 0 };
      await runScrapeItems(
        results,
        {
          concurrency: policy.concurrency,
          signal: controller.signal,
          control: {
            isStopRequested: () => this.#stopRequested.has(taskId),
            isPaused: () => this.#paused.has(taskId),
            onPaused: async () => {
              await this.transitionTask(taskId, "pause");
              await this.addEvent(taskId, "paused", "刮削任务已暂停");
              this.taskEvents.publish({ kind: "task", task: await this.toDto(taskId) });
            },
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
              return;
            }
            await policy.restGate?.waitBeforeStart(signal);
            await state.repositories.library.upsertScrapeResult({ ...result, status: "processing" });
            const root = await this.mediaRoots.getActiveRoot(result.rootId);
            const runtimeResult = await this.runtime.scrape({
              root,
              relativePath: result.relativePath,
              manualScrape: this.resolveManualScrape(result.manualUrl),
              progress: { fileIndex: index + 1, totalFiles: results.length },
              localState: this.resolveConfirmedLocalState(taskId, result),
              signal,
              onEvent: async (type, message) => {
                await this.addEvent(taskId, type, message);
              },
            });
            await this.persistRuntimeResult(taskId, result, root, runtimeResult, counters);
          },
        }),
      );
      if (this.#stopRequested.has(taskId)) {
        throw new Error("刮削已停止");
      }
      if (this.#paused.has(taskId)) {
        return;
      }
      this.#paused.delete(taskId);
      const output = await state.repositories.library.upsertScrapeOutput({
        taskId,
        rootId: results[0]?.rootId ?? null,
        outputDirectory: null,
        fileCount: counters.successCount,
        totalBytes: counters.totalBytes,
        completedAt: new Date(),
      });
      const next = transitionTask(toRuntimeTaskSnapshot(await state.repositories.tasks.get(taskId)), {
        action: counters.failedCount > 0 && counters.successCount === 0 ? "fail" : "complete",
        error: counters.failedCount > 0 && counters.successCount === 0 ? "所有文件刮削失败" : null,
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
        "completed",
        `刮削完成：${counters.successCount} 成功，${counters.failedCount} 失败，输出 ${output.id}`,
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
      await this.transitionTask(taskId, "fail", message);
      await this.addEvent(taskId, "failed", message);
      this.taskEvents.publish({ kind: "task", task: await this.toDto(taskId) });
    } finally {
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
      await state.repositories.library.upsertScrapeResult({
        ...result,
        status: "failed",
        error: runtimeResult.error,
      });
      await this.addEvent(taskId, "item-failed", `${result.relativePath}: ${runtimeResult.error}`);
      return;
    }

    const thumbnailPath = toRootRelativeAssetPath(
      root,
      runtimeResult.result.assets?.thumb ?? runtimeResult.result.assets?.poster,
    );
    const libraryAssets = toLibraryAssets(root, runtimeResult.result.assets);
    const stored = await state.repositories.library.upsertScrapeResult({
      id: result.id,
      taskId,
      rootId: result.rootId,
      relativePath: result.relativePath,
      status: "success",
      crawlerDataJson: JSON.stringify(runtimeResult.crawlerData),
      nfoRelativePath: runtimeResult.nfoRelativePath,
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
    await this.addEvent(taskId, "item-success", `已生成 NFO：${runtimeResult.nfoRelativePath ?? "未生成"}`);
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
      videoCount: task.videoCount || results.length,
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
}
