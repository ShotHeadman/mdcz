import { randomUUID } from "node:crypto";
import { loggerService } from "@main/services/LoggerService";
import PQueue from "p-queue";
import { isAbortError } from "../abort";
import { SessionProgressTracker } from "./SessionProgressTracker";
import { hasRecoverableWork, toRecoverableSnapshot } from "./SessionRecovery";
import { SessionStateStore } from "./SessionStateStore";
import type {
  PersistedSessionState,
  QueueTask,
  RecoverableSessionSnapshot,
  ScrapeSessionOptions,
  ScrapeSuccessItem,
  SessionState,
} from "./types";

export class ScrapeSession {
  private readonly logger = loggerService.getLogger("ScrapeSession");

  private readonly progress = new SessionProgressTracker();

  private readonly stateStore: SessionStateStore;

  private queue: PQueue | null = null;

  private taskId: string | null = null;

  private stopRequested = false;

  private controller: AbortController | null = null;

  constructor(options: ScrapeSessionOptions = {}) {
    this.stateStore = new SessionStateStore(this.logger, () => this.buildSnapshot(), options);
  }

  getStatus() {
    return this.progress.getStatus();
  }

  getState(): SessionState {
    return this.progress.getState();
  }

  getTaskId(): string | null {
    return this.taskId;
  }

  getFailedFiles(): string[] {
    return this.progress.getFailedFiles();
  }

  getSuccessItemsSnapshot(): ScrapeSuccessItem[] {
    return this.progress.getSuccessItemsSnapshot();
  }

  getSignal(): AbortSignal {
    if (!this.controller) {
      throw new Error("Scrape session is not active");
    }

    return this.controller.signal;
  }

  async hasRecoverableSession(): Promise<boolean> {
    return hasRecoverableWork(await this.stateStore.read());
  }

  async getRecoverableSnapshot(): Promise<RecoverableSessionSnapshot | null> {
    return toRecoverableSnapshot(await this.stateStore.read());
  }

  async discardRecoverableSession(): Promise<void> {
    if (this.getStatus().running) {
      throw new Error("Scrape session is active");
    }

    await this.stateStore.clear();
  }

  begin(files: string[], concurrency: number): string {
    if (this.getState() !== "idle") {
      throw new Error("Scrape session is already active");
    }

    this.taskId = randomUUID();
    this.stopRequested = false;
    this.controller = new AbortController();
    this.queue = new PQueue({ concurrency: Math.max(1, concurrency) });
    this.progress.begin(files);
    this.stateStore.start();

    return this.taskId;
  }

  addTask(task: QueueTask): boolean {
    if (!this.queue || !this.controller) {
      throw new Error("Scrape session is not active");
    }

    if (task.isRetry && !this.progress.queueRetry(task.sourcePath)) {
      return false;
    }

    if (task.isRetry) {
      this.stateStore.markDirty();
    }

    const signal = this.controller.signal;
    this.queue.add(async () => {
      if (this.stopRequested) {
        return;
      }

      const result = await task.taskFn(signal).catch((error) => {
        if (isAbortError(error)) {
          return null;
        }

        throw error;
      });
      if (!result) {
        return;
      }

      const update = this.progress.applyResult(task.sourcePath, result, task.isRetry);
      this.stateStore.markDirty();

      if (update.failureMembershipChanged) {
        void this.stateStore.flushNow();
      }
    });

    return true;
  }

  async onIdle(): Promise<void> {
    if (!this.queue) {
      return;
    }

    await this.queue.onIdle();
  }

  stop(): { pendingCount: number } {
    if (!this.queue || !this.getStatus().running) {
      return { pendingCount: 0 };
    }

    if (this.getState() !== "stopping") {
      this.progress.transitionTo("stopping");
      this.stopRequested = true;
      this.controller?.abort();
      this.stateStore.markDirty();
    }

    const pendingCount = this.queue.size;
    this.queue.clear();
    return { pendingCount };
  }

  pause(): void {
    if (!this.queue || this.getState() !== "running") {
      return;
    }

    this.queue.pause();
    this.progress.transitionTo("paused");
    this.stateStore.markDirty();
  }

  resume(): void {
    if (!this.queue || this.getState() !== "paused") {
      return;
    }

    this.queue.start();
    this.progress.transitionTo("running");
    this.stateStore.markDirty();
  }

  async finish(): Promise<void> {
    if (!this.getStatus().running && this.getState() === "idle") {
      return;
    }

    this.progress.finish();
    this.taskId = null;
    this.queue = null;
    this.stopRequested = false;
    this.controller = null;
    await this.stateStore.clear();
  }

  private buildSnapshot(): PersistedSessionState | null {
    if (!this.taskId || !this.getStatus().running) {
      return null;
    }

    return this.progress.buildSnapshot(this.taskId);
  }
}
