import { rm } from "node:fs/promises";
import path from "node:path";
import type { ScrapeResultRecord } from "@mdcz/persistence";
import { NfoGenerator, RuntimeScrapeProcessor } from "@mdcz/runtime/scrape";
import type {
  CrawlerDataDto,
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
  ScrapeResultDetailResponse,
  ScrapeResultDto,
  ScrapeResultListResponse,
  ScrapeStartInput,
  ScrapeTaskControlInput,
  TaskEventDto,
  TaskEventListResponse,
} from "@mdcz/shared/serverDtos";
import { resolveRootRelativePath } from "@mdcz/storage";
import type { MediaRootService } from "./mediaRootService";
import type { ServerPersistenceService } from "./persistenceService";
import type { TaskEventBus } from "./taskEvents";

const toIso = (value: Date | null): string | null => value?.toISOString() ?? null;

export class ScrapeService {
  #running = false;
  #stopRequested = new Set<string>();
  #paused = new Set<string>();
  private readonly runtime = new RuntimeScrapeProcessor(new NfoGenerator());

  constructor(
    private readonly persistence: ServerPersistenceService,
    private readonly mediaRoots: MediaRootService,
    private readonly taskEvents: TaskEventBus,
  ) {}

  async start(input: ScrapeStartInput): Promise<ScanTaskDto> {
    const firstRootId = input.refs[0].rootId;
    const task = await (await this.persistence.getState()).repositories.tasks.createTask({
      kind: "scrape",
      rootId: firstRootId,
    });
    for (const ref of input.refs) {
      await this.mediaRoots.getActiveRoot(ref.rootId);
      await this.upsertPendingResult(task.id, ref.rootId, ref.relativePath, input.manualUrl ?? null);
    }
    await this.addEvent(task.id, "queued", `刮削任务已排队：${input.refs.length} 个文件`);
    this.taskEvents.publish({ kind: "task", task: await this.toDto(task.id) });
    void this.drain();
    return await this.toDto(task.id);
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
    this.#stopRequested.add(input.taskId);
    const state = await this.persistence.getState();
    const task = await state.repositories.tasks.get(input.taskId);
    if (task.status === "queued" || task.status === "paused") {
      await state.repositories.tasks.patch(input.taskId, {
        status: "failed",
        completedAt: new Date(),
        error: "刮削已停止",
      });
    } else if (task.status === "running") {
      await state.repositories.tasks.patch(input.taskId, { status: "stopping" });
    }
    await this.addEvent(input.taskId, "stopping", "正在停止刮削任务");
    this.taskEvents.publish({ kind: "task", task: await this.toDto(input.taskId) });
    return await this.toDto(input.taskId);
  }

  async pause(input: ScrapeTaskControlInput): Promise<ScanTaskDto> {
    this.#paused.add(input.taskId);
    await (await this.persistence.getState()).repositories.tasks.patch(input.taskId, { status: "paused" });
    await this.addEvent(input.taskId, "paused", "刮削任务已暂停");
    this.taskEvents.publish({ kind: "task", task: await this.toDto(input.taskId) });
    return await this.toDto(input.taskId);
  }

  async resume(input: ScrapeTaskControlInput): Promise<ScanTaskDto> {
    this.#paused.delete(input.taskId);
    const state = await this.persistence.getState();
    const task = await state.repositories.tasks.get(input.taskId);
    if (task.status === "paused") {
      await state.repositories.tasks.patch(input.taskId, { status: "queued", startedAt: null });
    }
    await this.addEvent(input.taskId, "queued", "刮削任务已恢复排队");
    this.taskEvents.publish({ kind: "task", task: await this.toDto(input.taskId) });
    void this.drain();
    return await this.toDto(input.taskId);
  }

  async retry(input: ScrapeTaskControlInput): Promise<ScanTaskDto> {
    const state = await this.persistence.getState();
    const task = await state.repositories.tasks.get(input.taskId);
    if (task.status === "running" || task.status === "queued") {
      throw new Error("Only completed, failed, paused, or stopped scrape tasks can be retried");
    }
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
      });
    }
    await state.repositories.tasks.patch(input.taskId, {
      status: "queued",
      startedAt: null,
      completedAt: null,
      videoCount: 0,
      directoryCount: 0,
      error: null,
    });
    await this.addEvent(input.taskId, "queued", "重试刮削已排队");
    this.taskEvents.publish({ kind: "task", task: await this.toDto(input.taskId) });
    void this.drain();
    return await this.toDto(input.taskId);
  }

  async resumeQueued(): Promise<void> {
    const state = await this.persistence.getState();
    await state.repositories.tasks.requeueRunning("scrape");
    void this.drain();
  }

  async nfoRead(input: NfoReadInput): Promise<NfoReadResponse> {
    const root = await this.mediaRoots.getActiveRoot(input.rootId);
    const result = await this.runtime.readNfo(root, input.relativePath);
    return {
      rootId: input.rootId,
      relativePath: input.relativePath,
      exists: result.exists,
      data: result.data,
    };
  }

  async nfoWrite(input: NfoWriteInput): Promise<NfoWriteResponse> {
    const root = await this.mediaRoots.getActiveRoot(input.rootId);
    await this.runtime.writeNfo(root, input.relativePath, input.data);
    return { rootId: input.rootId, relativePath: input.relativePath, data: input.data };
  }

  async deleteFile(input: FileActionInput): Promise<FileActionResponse> {
    const root = await this.mediaRoots.getActiveRoot(input.rootId);
    await rm(resolveRootRelativePath(root, input.relativePath), { force: true });
    return { ok: true, rootId: input.rootId, relativePath: input.relativePath };
  }

  private async drain(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      while (true) {
        const state = await this.persistence.getState();
        const task = await state.repositories.tasks.nextQueued("scrape");
        if (!task) return;
        await this.runTask(task.id);
      }
    } finally {
      this.#running = false;
    }
  }

  private async runTask(taskId: string): Promise<void> {
    const state = await this.persistence.getState();
    await state.repositories.tasks.patch(taskId, { status: "running", startedAt: new Date(), error: null });
    await this.addEvent(taskId, "running", "开始刮削媒体文件");
    this.taskEvents.publish({ kind: "task", task: await this.toDto(taskId) });

    try {
      const results = await state.repositories.library.listScrapeResults(taskId);
      let successCount = 0;
      let failedCount = 0;
      let totalBytes = 0;
      for (const result of results) {
        if (this.#stopRequested.has(taskId)) {
          throw new Error("刮削已停止");
        }
        if (this.#paused.has(taskId)) {
          return;
        }
        await state.repositories.library.upsertScrapeResult({ ...result, status: "processing" });
        const root = await this.mediaRoots.getActiveRoot(result.rootId);
        const runtimeResult = await this.runtime.scrapePlaceholder({
          root,
          relativePath: result.relativePath,
          manualUrl: result.manualUrl,
        });
        if (runtimeResult.status === "failed") {
          failedCount += 1;
          await state.repositories.library.upsertScrapeResult({
            ...result,
            status: "failed",
            error: runtimeResult.error,
          });
          await this.addEvent(taskId, "item-failed", `${result.relativePath}: ${runtimeResult.error}`);
          continue;
        }

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
        });
        totalBytes += runtimeResult.size;
        await state.repositories.library.upsertEntry({
          rootId: result.rootId,
          rootRelativePath: result.relativePath,
          size: runtimeResult.size,
          modifiedAt: runtimeResult.modifiedAt,
          sourceTaskId: taskId,
          scrapeOutputId: stored.id,
          title: runtimeResult.crawlerData.title,
          number: runtimeResult.crawlerData.number,
          actors: runtimeResult.crawlerData.actors,
          thumbnailPath: runtimeResult.crawlerData.thumb_url ?? runtimeResult.crawlerData.poster_url ?? null,
          lastKnownPath: result.relativePath,
        });
        successCount += 1;
        await this.addEvent(taskId, "item-success", `已生成 NFO：${runtimeResult.nfoRelativePath}`);
      }
      const output = await state.repositories.library.upsertScrapeOutput({
        taskId,
        rootId: results[0]?.rootId ?? null,
        outputDirectory: null,
        fileCount: successCount,
        totalBytes,
        completedAt: new Date(),
      });
      await state.repositories.tasks.patch(taskId, {
        status: failedCount > 0 && successCount === 0 ? "failed" : "completed",
        completedAt: new Date(),
        videoCount: successCount,
        directoryCount: 0,
        error: failedCount > 0 && successCount === 0 ? "所有文件刮削失败" : null,
      });
      await this.addEvent(
        taskId,
        "completed",
        `刮削完成：${successCount} 成功，${failedCount} 失败，输出 ${output.id}`,
      );
      this.taskEvents.publish({ kind: "task", task: await this.toDto(taskId) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await state.repositories.tasks.patch(taskId, { status: "failed", completedAt: new Date(), error: message });
      await this.addEvent(taskId, "failed", message);
      this.taskEvents.publish({ kind: "task", task: await this.toDto(taskId) });
    } finally {
      this.#stopRequested.delete(taskId);
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

  private async toDto(taskId: string): Promise<ScanTaskDto> {
    const state = await this.persistence.getState();
    const task = await state.repositories.tasks.get(taskId);
    const root = await state.repositories.mediaRoots.get(task.rootId, { includeDeleted: true }).catch(() => null);
    const results = await state.repositories.library.listScrapeResults(taskId);
    return {
      id: task.id,
      kind: task.kind,
      rootId: task.rootId,
      rootDisplayName: root?.displayName ?? "未知媒体目录",
      status: task.status,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      startedAt: toIso(task.startedAt),
      completedAt: toIso(task.completedAt),
      videoCount: task.videoCount || results.length,
      directoryCount: task.directoryCount,
      error: task.error,
      videos: results.map((result) => result.relativePath),
    };
  }

  private async resultToDto(record: ScrapeResultRecord): Promise<ScrapeResultDto> {
    const root = await (await this.persistence.getState()).repositories.mediaRoots
      .get(record.rootId, { includeDeleted: true })
      .catch(() => null);
    return {
      id: record.id,
      taskId: record.taskId,
      rootId: record.rootId,
      rootDisplayName: root?.displayName ?? "未知媒体目录",
      relativePath: record.relativePath,
      fileName: path.posix.basename(record.relativePath),
      status: record.status,
      error: record.error,
      crawlerData: record.crawlerDataJson ? (JSON.parse(record.crawlerDataJson) as CrawlerDataDto) : null,
      nfoRelativePath: record.nfoRelativePath,
      outputRelativePath: record.outputRelativePath,
      manualUrl: record.manualUrl,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private async addEvent(taskId: string, type: string, message: string): Promise<TaskEventDto> {
    const event = await (await this.persistence.getState()).repositories.tasks.addEvent({ taskId, type, message });
    const dto = toTaskEventDto(event);
    this.taskEvents.publish({ kind: "event", event: dto });
    return dto;
  }
}

const toTaskEventDto = (event: {
  id: string;
  taskId: string;
  type: string;
  message: string;
  createdAt: Date;
}): TaskEventDto => ({
  id: event.id,
  taskId: event.taskId,
  type: event.type,
  message: event.message,
  createdAt: event.createdAt.toISOString(),
});
