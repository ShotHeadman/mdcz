import { isAbortError } from "../../scrape/utils/abort";
import { TaskExecutor } from "../executor";
import { InMemoryScrapeSessionExecutionStore } from "./InMemoryScrapeSessionExecutionStore";
import { SessionProgressTracker } from "./SessionProgressTracker";
import type {
  QueueTask,
  RecoverableSessionSnapshot,
  ScrapeSessionExecutionStore,
  ScrapeSessionOptions,
  ScrapeSuccessItem,
  SessionExecution,
  SessionState,
} from "./types";

interface ExecutedQueueTask {
  owned: boolean;
  result: Awaited<ReturnType<QueueTask["taskFn"]>> | null;
}

export class ScrapeSession {
  private readonly progress = new SessionProgressTracker();
  private readonly executionStore: ScrapeSessionExecutionStore;
  private pendingTasks: QueueTask[] = [];
  private executor: TaskExecutor<QueueTask, ExecutedQueueTask> | null = null;
  private execution: SessionExecution | null = null;
  private runPromise: Promise<void> | null = null;
  private stopRequested = false;
  private concurrency = 1;

  constructor(options: ScrapeSessionOptions = {}) {
    this.executionStore = options.executionStore ?? new InMemoryScrapeSessionExecutionStore();
  }

  getStatus() {
    return this.progress.getStatus();
  }

  getState(): SessionState {
    return this.progress.getState();
  }

  getTaskId(): string | null {
    return this.execution?.taskId ?? null;
  }

  getFailedFiles(): string[] {
    return this.progress.getFailedFiles();
  }

  getSuccessItemsSnapshot(): ScrapeSuccessItem[] {
    return this.progress.getSuccessItemsSnapshot();
  }

  async hasRecoverableSession(): Promise<boolean> {
    return (await this.executionStore.getRecoverable()) !== null;
  }

  async getRecoverableSnapshot(): Promise<RecoverableSessionSnapshot | null> {
    return await this.executionStore.getRecoverable();
  }

  async discardRecoverableSession(): Promise<void> {
    if (this.getStatus().running) throw new Error("Scrape session is active");
    const snapshot = await this.executionStore.getRecoverable();
    if (snapshot) await this.executionStore.discard(snapshot.taskId);
  }

  async begin(files: string[], concurrency: number, recoverTaskId?: string): Promise<string> {
    if (this.getState() !== "idle") throw new Error("Scrape session is already active");
    this.execution = recoverTaskId
      ? await this.executionStore.recover(recoverTaskId)
      : await this.executionStore.create(files);
    this.concurrency = Math.max(1, Math.trunc(concurrency));
    this.pendingTasks = [];
    this.stopRequested = false;
    this.progress.begin(files);
    return this.execution.taskId;
  }

  async addTask(task: QueueTask): Promise<boolean> {
    const execution = this.requireExecution();
    if (task.isRetry) {
      if (!this.progress.queueRetry(task.sourcePath)) return false;
      if (!(await this.executionStore.queueRetry(execution, task.sourcePath))) return false;
    }
    this.pendingTasks.push(task);
    return true;
  }

  async onIdle(): Promise<void> {
    if (!this.execution) return;
    if (!this.runPromise) {
      const run = this.drain();
      this.runPromise = run;
      const clear = () => {
        if (this.runPromise === run) this.runPromise = null;
      };
      void run.then(clear, clear);
    }
    await this.runPromise;
  }

  async stop(): Promise<{ pendingCount: number }> {
    if (!this.execution || !this.getStatus().running) return { pendingCount: 0 };
    const pendingCount = this.progress.getPendingFiles().length;
    this.stopRequested = true;
    this.executor?.stop();
    this.progress.transitionTo("stopping");
    await this.executionStore.stop(this.execution);
    return { pendingCount };
  }

  async pause(): Promise<void> {
    if (!this.execution || this.getState() !== "running") return;
    this.executor?.pause();
    if (!(await this.executionStore.pause(this.execution))) return;
    this.progress.transitionTo("paused");
  }

  async resume(): Promise<void> {
    if (!this.execution || this.getState() !== "paused") return;
    await this.executor?.waitForIdle();
    const resumed = await this.executionStore.resume(this.execution);
    if (!resumed) return;
    this.execution = resumed;
    this.progress.transitionTo("running");
  }

  async finish(): Promise<void> {
    if (!this.execution || (!this.getStatus().running && this.getState() === "idle")) return;
    await this.executionStore.complete(this.execution, this.progress.getStatus());
    this.progress.finish();
    this.execution = null;
    this.executor = null;
    this.pendingTasks = [];
    this.stopRequested = false;
  }

  private async drain(): Promise<void> {
    while (!this.stopRequested) {
      if (this.getState() === "paused") {
        return;
      }
      if (this.pendingTasks.length === 0) return;

      const execution = this.requireExecution();
      const batch = this.pendingTasks.splice(0);
      const started = new Set<QueueTask>();
      const executor = new TaskExecutor<QueueTask, ExecutedQueueTask>({
        concurrency: this.concurrency,
        gate: { beforeItem: async (task) => void started.add(task) },
        runItem: async (task, context) => {
          const owned = await this.executionStore.markProcessing(execution, task.sourcePath);
          if (!owned) return { owned: false, result: null };
          try {
            return { owned: true, result: await task.taskFn(context.signal) };
          } catch (error) {
            if (isAbortError(error) || context.signal.aborted) return { owned: true, result: null };
            throw error;
          }
        },
        applyResult: async (task, executed) => {
          if (!executed.owned) return;
          const committed = await this.executionStore.markResult(execution, task.sourcePath, executed.result);
          if (!committed) return;
          if (executed.result) this.progress.applyResult(task.sourcePath, executed.result, task.isRetry);
          else this.progress.applyStopped(task.sourcePath, task.isRetry);
        },
      });
      this.executor = executor;
      const summary = await executor.execute(batch, execution.executionVersion);
      this.pendingTasks.unshift(...batch.filter((task) => !started.has(task)));
      if (this.executor === executor) this.executor = null;

      if (summary.outcome === "paused") {
        return;
      } else if (summary.outcome === "stopped") {
        for (const task of this.pendingTasks.splice(0)) {
          if (await this.executionStore.markResult(execution, task.sourcePath, null)) {
            this.progress.applyStopped(task.sourcePath, task.isRetry);
          }
        }
        return;
      }
    }
  }

  private requireExecution(): SessionExecution {
    if (!this.execution) throw new Error("Scrape session is not active");
    return this.execution;
  }
}
