import type { ScrapeResult } from "@mdcz/shared/types";
import {
  createIdleScraperStatus,
  type RecoverableSessionSnapshot,
  type ScrapeSessionExecutionStore,
  type SessionExecution,
} from "./types";

interface MemoryExecution extends SessionExecution {
  files: Map<string, "pending" | "processing" | "success" | "failed" | "skipped">;
  state: "running" | "paused" | "stopping" | "completed" | "failed";
}

export class InMemoryScrapeSessionExecutionStore implements ScrapeSessionExecutionStore {
  private execution: MemoryExecution | null = null;
  private nextId = 1;

  async create(files: readonly string[]): Promise<SessionExecution> {
    this.execution = {
      taskId: `memory-scrape-${this.nextId++}`,
      executionVersion: 1,
      files: new Map(files.map((file) => [file, "pending"] as const)),
      state: "running",
    };
    return this.snapshotExecution();
  }

  async recover(taskId: string): Promise<SessionExecution> {
    const execution = this.requireExecution(taskId);
    execution.executionVersion += 1;
    execution.state = "running";
    for (const [file, status] of execution.files) {
      if (status === "processing" || status === "failed") execution.files.set(file, "pending");
    }
    return this.snapshotExecution();
  }

  async getRecoverable(): Promise<RecoverableSessionSnapshot | null> {
    const execution = this.execution;
    if (!execution || execution.state === "completed") return null;
    const pendingFiles = [...execution.files]
      .filter(([, status]) => status === "pending" || status === "processing")
      .map(([file]) => file);
    const failedFiles = [...execution.files].filter(([, status]) => status === "failed").map(([file]) => file);
    if (pendingFiles.length === 0 && failedFiles.length === 0) return null;
    return {
      taskId: execution.taskId,
      status: {
        ...createIdleScraperStatus(),
        state: execution.state === "paused" ? "paused" : "running",
        running: true,
        totalFiles: execution.files.size,
      },
      pendingFiles,
      failedFiles,
    };
  }

  async discard(taskId: string): Promise<void> {
    const execution = this.requireExecution(taskId);
    execution.state = "failed";
    for (const [file, status] of execution.files) {
      if (status === "pending" || status === "processing" || status === "failed") execution.files.set(file, "skipped");
    }
  }

  async markProcessing(execution: SessionExecution, sourcePath: string): Promise<boolean> {
    if (!this.owns(execution, ["running", "paused", "stopping"])) return false;
    this.requireExecution(execution.taskId).files.set(sourcePath, "processing");
    return true;
  }

  async markResult(execution: SessionExecution, sourcePath: string, result: ScrapeResult | null): Promise<boolean> {
    if (!this.owns(execution, ["running", "paused", "stopping"])) return false;
    this.requireExecution(execution.taskId).files.set(
      sourcePath,
      result?.status === "success" ? "success" : result?.status === "failed" ? "failed" : "skipped",
    );
    return true;
  }

  async queueRetry(execution: SessionExecution, sourcePath: string): Promise<boolean> {
    if (!this.owns(execution, ["running", "paused"])) return false;
    const current = this.requireExecution(execution.taskId).files.get(sourcePath);
    if (current !== "failed") return false;
    this.requireExecution(execution.taskId).files.set(sourcePath, "pending");
    return true;
  }

  async pause(execution: SessionExecution): Promise<boolean> {
    if (!this.owns(execution, ["running"])) return false;
    this.requireExecution(execution.taskId).state = "paused";
    return true;
  }

  async resume(execution: SessionExecution): Promise<SessionExecution | null> {
    if (!this.owns(execution, ["paused"])) return null;
    const current = this.requireExecution(execution.taskId);
    current.executionVersion += 1;
    current.state = "running";
    return this.snapshotExecution();
  }

  async stop(execution: SessionExecution): Promise<boolean> {
    if (!this.owns(execution, ["running", "paused"])) return false;
    this.requireExecution(execution.taskId).state = "stopping";
    return true;
  }

  async complete(execution: SessionExecution, status: { successCount: number }): Promise<boolean> {
    if (!this.owns(execution, ["running", "stopping"])) return false;
    this.requireExecution(execution.taskId).state = status.successCount > 0 ? "completed" : "failed";
    return true;
  }

  private owns(execution: SessionExecution, states: MemoryExecution["state"][]): boolean {
    return Boolean(
      this.execution &&
        this.execution.taskId === execution.taskId &&
        this.execution.executionVersion === execution.executionVersion &&
        states.includes(this.execution.state),
    );
  }

  private requireExecution(taskId: string): MemoryExecution {
    if (!this.execution || this.execution.taskId !== taskId) throw new Error(`Scrape execution not found: ${taskId}`);
    return this.execution;
  }

  private snapshotExecution(): SessionExecution {
    const execution = this.requireExecution(this.execution?.taskId ?? "");
    return { taskId: execution.taskId, executionVersion: execution.executionVersion };
  }
}
