import path from "node:path";
import { resolveRootRelativePath, toRootRelativePath } from "@mdcz/media-store";
import type { ScrapeResultRecord, TaskRecord } from "@mdcz/persistence";
import { createDesktopInputRoot } from "@mdcz/runtime/library";
import type { RecoverableSessionSnapshot, ScrapeSessionExecutionStore, SessionExecution } from "@mdcz/runtime/tasks";
import type { ScrapeResult, ScraperStatus } from "@mdcz/shared/types";
import type { DesktopPersistenceService } from "../persistence";

const recoverableTaskStatuses = new Set(["queued", "running", "paused", "stopping", "failed"]);
const recoverableItemStatuses = new Set(["pending", "processing", "failed"]);

export class DesktopScrapeExecutionStore implements ScrapeSessionExecutionStore {
  private readonly resultBySourcePath = new Map<string, ScrapeResultRecord>();

  constructor(
    private readonly persistence: DesktopPersistenceService,
    private readonly getConfiguredMediaPath: () => Promise<string>,
  ) {}

  async create(files: readonly string[]): Promise<SessionExecution> {
    const state = await this.persistence.getState();
    const root = createDesktopInputRoot(await this.resolveRootPath(files));
    await state.repositories.mediaRoots.upsert(root);
    const task = await state.repositories.tasks.createTask({ kind: "scrape", rootId: root.id });
    this.resultBySourcePath.clear();
    for (const sourcePath of files) {
      const result = await state.repositories.library.upsertScrapeResult({
        taskId: task.id,
        rootId: root.id,
        relativePath: toRootRelativePath(root, sourcePath),
        status: "pending",
      });
      this.resultBySourcePath.set(path.resolve(sourcePath), result);
    }
    const claimed = await state.repositories.tasks.claim(task.id, task.executionVersion);
    if (!claimed) throw new Error(`Failed to claim desktop scrape execution: ${task.id}`);
    return { taskId: claimed.id, executionVersion: claimed.executionVersion };
  }

  async recover(taskId: string): Promise<SessionExecution> {
    const state = await this.persistence.getState();
    const task = await state.repositories.tasks.get(taskId);
    const root = await state.repositories.mediaRoots.get(task.rootId, { includeDeleted: true });
    const results = await state.repositories.library.listScrapeResults(taskId);
    this.resultBySourcePath.clear();
    for (const result of results) {
      const sourcePath = resolveRootRelativePath(root, result.relativePath);
      const next = recoverableItemStatuses.has(result.status)
        ? await state.repositories.library.upsertScrapeResult({ ...result, status: "pending", error: null })
        : result;
      this.resultBySourcePath.set(path.resolve(sourcePath), next);
    }
    const queued = await state.repositories.tasks.requeue(task.id, {
      status: ["queued", "running", "paused", "stopping", "failed"],
      executionVersion: task.executionVersion,
    });
    if (!queued) throw new Error(`Failed to requeue desktop scrape execution: ${task.id}`);
    const claimed = await state.repositories.tasks.claim(queued.id, queued.executionVersion);
    if (!claimed) throw new Error(`Failed to reclaim desktop scrape execution: ${task.id}`);
    return { taskId: claimed.id, executionVersion: claimed.executionVersion };
  }

  async getRecoverable(): Promise<RecoverableSessionSnapshot | null> {
    const state = await this.persistence.getState();
    for (const task of await state.repositories.tasks.list("scrape")) {
      if (!recoverableTaskStatuses.has(task.status)) continue;
      const results = await state.repositories.library.listScrapeResults(task.id);
      const recoverable = results.filter((result) => recoverableItemStatuses.has(result.status));
      if (recoverable.length === 0) continue;
      const root = await state.repositories.mediaRoots.get(task.rootId, { includeDeleted: true });
      const toSourcePath = (result: ScrapeResultRecord) => resolveRootRelativePath(root, result.relativePath);
      return {
        taskId: task.id,
        status: this.toScraperStatus(task, results),
        pendingFiles: recoverable
          .filter((result) => result.status === "pending" || result.status === "processing")
          .map(toSourcePath),
        failedFiles: recoverable.filter((result) => result.status === "failed").map(toSourcePath),
      };
    }
    return null;
  }

  async discard(taskId: string): Promise<void> {
    const state = await this.persistence.getState();
    const task = await state.repositories.tasks.get(taskId);
    for (const result of await state.repositories.library.listScrapeResults(taskId)) {
      if (!recoverableItemStatuses.has(result.status)) continue;
      await state.repositories.library.upsertScrapeResult({
        ...result,
        status: "skipped",
        error: "已放弃未完成刮削",
      });
    }
    await state.repositories.tasks.patch(taskId, {
      status: "failed",
      completedAt: new Date(),
      error: "已放弃未完成刮削",
    });
    if (task.id === taskId) this.resultBySourcePath.clear();
  }

  async markProcessing(execution: SessionExecution, sourcePath: string): Promise<boolean> {
    const result = await this.requireResult(execution.taskId, sourcePath);
    const stored = await (await this.persistence.getState()).repositories.library.upsertOwnedScrapeResult(execution, {
      ...result,
      status: "processing",
      error: null,
    });
    if (stored) this.resultBySourcePath.set(path.resolve(sourcePath), stored);
    return Boolean(stored);
  }

  async markResult(execution: SessionExecution, sourcePath: string, result: ScrapeResult | null): Promise<boolean> {
    const record = await this.requireResult(execution.taskId, sourcePath);
    const terminalStatus =
      result?.status === "success" ? "success" : result?.status === "failed" ? "failed" : "skipped";
    const stored = await (await this.persistence.getState()).repositories.library.upsertOwnedScrapeResult(execution, {
      ...record,
      status: terminalStatus,
      error: result?.error ?? (result ? null : "刮削已停止"),
      crawlerDataJson: result?.crawlerData ? JSON.stringify(result.crawlerData) : null,
    });
    if (stored) this.resultBySourcePath.set(path.resolve(sourcePath), stored);
    return Boolean(stored);
  }

  async queueRetry(execution: SessionExecution, sourcePath: string): Promise<boolean> {
    const result = await this.requireResult(execution.taskId, sourcePath);
    if (result.status !== "failed") return false;
    const stored = await (await this.persistence.getState()).repositories.library.upsertOwnedScrapeResult(execution, {
      ...result,
      status: "pending",
      error: null,
    });
    if (stored) this.resultBySourcePath.set(path.resolve(sourcePath), stored);
    return Boolean(stored);
  }

  async pause(execution: SessionExecution): Promise<boolean> {
    const task = await (await this.persistence.getState()).repositories.tasks.patch(
      execution.taskId,
      { status: "paused" },
      { status: "running", executionVersion: execution.executionVersion },
    );
    return Boolean(task);
  }

  async resume(execution: SessionExecution): Promise<SessionExecution | null> {
    const tasks = (await this.persistence.getState()).repositories.tasks;
    const resumed = await tasks.patch(
      execution.taskId,
      { status: "running" },
      { status: "paused", executionVersion: execution.executionVersion },
    );
    return resumed ? { taskId: resumed.id, executionVersion: resumed.executionVersion } : null;
  }

  async stop(execution: SessionExecution): Promise<boolean> {
    const task = await (await this.persistence.getState()).repositories.tasks.patch(
      execution.taskId,
      { status: "stopping", error: "刮削已停止" },
      { status: ["running", "paused"], executionVersion: execution.executionVersion },
    );
    return Boolean(task);
  }

  async complete(execution: SessionExecution, status: ScraperStatus): Promise<boolean> {
    const failed = status.successCount === 0 && status.failedCount > 0;
    const task = await (await this.persistence.getState()).repositories.tasks.patch(
      execution.taskId,
      {
        status: failed || status.state === "stopping" ? "failed" : "completed",
        completedAt: new Date(),
        videoCount: status.successCount,
        error: status.state === "stopping" ? "刮削已停止" : failed ? "All files failed to scrape" : null,
      },
      { status: ["running", "stopping"], executionVersion: execution.executionVersion },
    );
    return Boolean(task);
  }

  private async requireResult(taskId: string, sourcePath: string): Promise<ScrapeResultRecord> {
    const key = path.resolve(sourcePath);
    const cached = this.resultBySourcePath.get(key);
    if (cached?.taskId === taskId) return cached;
    const state = await this.persistence.getState();
    const task = await state.repositories.tasks.get(taskId);
    const root = await state.repositories.mediaRoots.get(task.rootId, { includeDeleted: true });
    const relativePath = toRootRelativePath(root, key);
    const result = (await state.repositories.library.listScrapeResults(taskId)).find(
      (candidate) => candidate.relativePath === relativePath,
    );
    if (!result) throw new Error(`Scrape item not found: ${sourcePath}`);
    this.resultBySourcePath.set(key, result);
    return result;
  }

  private async resolveRootPath(files: readonly string[]): Promise<string> {
    const configured = (await this.getConfiguredMediaPath()).trim();
    if (configured) {
      const root = createDesktopInputRoot(configured);
      if (files.every((file) => this.isWithin(root.hostPath, file))) return root.hostPath;
    }
    if (files.length === 0) throw new Error("Cannot create a scrape root without files");
    let common = path.dirname(path.resolve(files[0]));
    for (const file of files.slice(1)) {
      const resolved = path.resolve(file);
      while (!this.isWithin(common, resolved)) {
        const parent = path.dirname(common);
        if (parent === common) throw new Error("Selected files do not share a filesystem root");
        common = parent;
      }
    }
    return common;
  }

  private isWithin(rootPath: string, candidatePath: string): boolean {
    const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  }

  private toScraperStatus(task: TaskRecord, results: ScrapeResultRecord[]): ScraperStatus {
    const terminal = results.filter((result) => ["success", "failed", "skipped"].includes(result.status)).length;
    return {
      state: task.status === "paused" ? "paused" : task.status === "stopping" ? "stopping" : "running",
      running: true,
      totalFiles: results.length,
      completedFiles: terminal,
      successCount: results.filter((result) => result.status === "success").length,
      failedCount: results.filter((result) => result.status === "failed").length,
      skippedCount: results.filter((result) => result.status === "skipped").length,
    };
  }
}
