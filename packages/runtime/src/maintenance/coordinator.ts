import type {
  MaintenanceActiveSessionSnapshot,
  MaintenanceApplyBatch,
  MaintenanceApplySelection,
  MaintenancePreviewBatch,
  MaintenanceTaskApplyLog,
  MaintenanceTaskEvent,
  MaintenanceTaskRef,
  MaintenanceTaskSnapshot,
} from "@mdcz/shared/maintenanceTasks";
import type { MaintenancePresetId } from "@mdcz/shared/types";
import {
  type MaintenanceCoordinatorEventSink,
  type MaintenanceLibraryPort,
  type MaintenanceRootPort,
  type MaintenanceRunHandle,
  noopMaintenanceCoordinatorEventSink,
} from "./coordinatorContracts";
import { MaintenanceApplyRunner } from "./MaintenanceApplyRunner";
import { MaintenanceEventProjector } from "./MaintenanceEventProjector";
import type { ActiveMaintenanceExecution, MaintenanceRunnerDependencies } from "./MaintenanceExecution";
import { MaintenancePreviewRunner } from "./MaintenancePreviewRunner";
import type { MaintenanceRuntime } from "./MaintenanceRuntime";
import {
  APPLY_FAILED,
  assertUniqueMaintenanceRefs,
  INTERRUPTED,
  isActiveMaintenanceSession,
  MaintenanceSessionStore,
  PREVIEW_ALL_FAILED,
  STOPPED,
  STOPPED_ITEM,
} from "./MaintenanceSessionState";

interface MaintenanceTaskCoordinatorDependencies {
  roots: MaintenanceRootPort;
  runtime: MaintenanceRuntime;
  library: MaintenanceLibraryPort;
  events?: MaintenanceCoordinatorEventSink;
  concurrency: 1;
}

/** Public facade for a single maintenance session and its two execution phases. */
export class MaintenanceTaskCoordinator {
  private readonly sessions = new MaintenanceSessionStore();
  private readonly projector: MaintenanceEventProjector;
  private readonly previewRunner: MaintenancePreviewRunner;
  private readonly applyRunner: MaintenanceApplyRunner;
  private readonly roots: MaintenanceRootPort;
  private readonly runtime: MaintenanceRuntime;
  private active: ActiveMaintenanceExecution | null = null;
  private executionPromise: Promise<void> | null = null;
  private readonly changeWaiters = new Map<string, Set<() => void>>();
  private closing = false;

  constructor(deps: MaintenanceTaskCoordinatorDependencies) {
    if (deps.concurrency !== 1) throw new Error("Maintenance coordinator concurrency must be 1");
    this.roots = deps.roots;
    this.runtime = deps.runtime;
    this.projector = new MaintenanceEventProjector(deps.events ?? noopMaintenanceCoordinatorEventSink, (taskId) =>
      this.notify(taskId),
    );
    const runnerDeps: MaintenanceRunnerDependencies = {
      roots: deps.roots,
      runtime: deps.runtime,
      library: deps.library,
      sessions: this.sessions,
      projector: this.projector,
      activate: (execution) => {
        this.active = execution;
      },
      deactivate: (sessionId, generation) => {
        if (this.active?.sessionId === sessionId && this.active.generation === generation) this.active = null;
      },
      finish: async (sessionId, generation, status, error) =>
        await this.finishSession(sessionId, generation, status, error),
      fail: async (sessionId, generation, error) => await this.failSession(sessionId, generation, error),
      isClosing: () => this.closing,
      notify: (taskId) => this.notify(taskId),
    };
    this.previewRunner = new MaintenancePreviewRunner(runnerDeps);
    this.applyRunner = new MaintenanceApplyRunner(runnerDeps);
  }

  async startPreview(input: {
    rootId: string;
    presetId: MaintenancePresetId;
    refs?: readonly MaintenanceTaskRef[];
  }): Promise<MaintenanceRunHandle<MaintenancePreviewBatch>> {
    this.assertOpen();
    const refs = [...(input.refs ?? [])];
    assertUniqueMaintenanceRefs(refs);
    await this.roots.getActiveRoot(input.rootId);
    const session = this.sessions.createPreviewSession({ rootId: input.rootId, presetId: input.presetId, refs });
    await this.projector.taskStatus(session, "queued", `Maintenance task queued. Preset: ${input.presetId}`);
    await this.projector.log(session, "preset", `Maintenance preset: ${input.presetId}`);
    await this.startCurrentPhase(session.id, session.generation);
    return {
      task: this.projector.task(this.sessions.require(session.id)),
      completion: this.waitForPreview(session.id),
    };
  }

  async readPreview(taskId: string): Promise<MaintenancePreviewBatch> {
    const session = this.sessions.require(taskId);
    return { task: this.projector.task(session), items: this.projector.editablePreviews(session) };
  }

  async waitForPreview(taskId: string): Promise<MaintenancePreviewBatch> {
    for (;;) {
      const batch = await this.readPreview(taskId);
      if (batch.task.status === "completed") return batch;
      if (batch.task.status === "failed") {
        if (batch.task.error === PREVIEW_ALL_FAILED) return batch;
        throw new Error(batch.task.error ?? "维护预览失败");
      }
      await this.waitForChange(taskId);
    }
  }

  async beginApply(input: {
    taskId: string;
    selections: readonly MaintenanceApplySelection[];
  }): Promise<MaintenanceRunHandle<MaintenanceApplyBatch>> {
    this.assertOpen();
    const { session, batchId, selectedIds } = this.sessions.beginApply(input);
    await this.projector.taskStatus(session, "queued", `Maintenance apply queued. Items: ${input.selections.length}`);
    await this.startCurrentPhase(session.id, session.generation);
    return {
      task: this.projector.task(session),
      completion: this.waitForApply(session.id, batchId, selectedIds),
    };
  }

  async pause(taskId: string): Promise<MaintenanceTaskSnapshot> {
    const current = this.sessions.require(taskId);
    if (current.status !== "queued" && current.status !== "running") return this.projector.task(current);
    const session = this.sessions.pause(taskId);
    await this.projector.taskStatus(session, "paused", "Maintenance task paused");
    this.activeFor(session.id, session.generation)?.executor.pause();
    await this.awaitCurrentExecution();
    return this.projector.task(this.sessions.require(taskId));
  }

  async resume(taskId: string): Promise<MaintenanceTaskSnapshot> {
    const session = this.sessions.require(taskId);
    if (session.status !== "paused") return this.projector.task(session);
    await this.awaitCurrentExecution();
    const current = this.sessions.require(taskId);
    if (current.status !== "paused") return this.projector.task(current);
    await this.startCurrentPhase(current.id, current.generation, "Maintenance task resumed");
    return this.projector.task(current);
  }

  async stop(taskId: string): Promise<MaintenanceTaskSnapshot> {
    const current = this.sessions.require(taskId);
    if (current.status === "completed" || current.status === "failed") return this.projector.task(current);

    const { session, generation } = this.sessions.beginStopping(taskId, STOPPED);
    await this.projector.taskStatus(session, "stopping", "Stopping maintenance task");
    this.active?.executor.stop();
    await this.awaitCurrentExecution();

    const latest = this.sessions.require(taskId);
    if (latest.generation !== generation) return this.projector.task(latest);
    if (latest.phase === "apply") await this.applyRunner.skipOutstanding(latest.id, generation, STOPPED_ITEM);
    await this.finishSession(latest.id, generation, "failed", STOPPED);
    return this.projector.task(latest);
  }

  async getTask(taskId: string): Promise<MaintenanceTaskSnapshot> {
    return this.projector.task(this.sessions.require(taskId));
  }

  async listTasks(): Promise<MaintenanceTaskSnapshot[]> {
    const session = this.sessions.current;
    return session ? [this.projector.task(session)] : [];
  }

  async listEvents(taskId: string): Promise<MaintenanceTaskEvent[]> {
    return [...this.sessions.require(taskId).events];
  }

  async listApplyLogs(taskId: string): Promise<MaintenanceTaskApplyLog[]> {
    return this.projector.applyLogs(this.sessions.require(taskId));
  }

  async getActiveSession(): Promise<MaintenanceActiveSessionSnapshot | null> {
    const session = this.sessions.current;
    return session ? this.projector.activeSession(session) : null;
  }

  async updateDraft(input: {
    taskId: string;
    previewId: string;
    fieldSelections?: Record<string, "old" | "new">;
    imageSelections?: Record<string, string>;
  }): Promise<MaintenanceActiveSessionSnapshot> {
    const session = this.sessions.require(input.taskId);
    const preview = session.previews.get(input.previewId);
    if (!preview || (preview.status !== "ready" && preview.status !== "blocked")) {
      throw new Error("维护预览不存在或已提交");
    }
    if (input.fieldSelections) session.draft.fieldSelections[input.previewId] = { ...input.fieldSelections };
    if (input.imageSelections) session.draft.imageSelections[input.previewId] = { ...input.imageSelections };
    this.sessions.touch(session);
    return this.projector.activeSession(session);
  }

  async discardSession(taskId?: string): Promise<void> {
    const discardedId = this.sessions.discard(taskId);
    if (discardedId) this.notify(discardedId);
  }

  async waitForIdle(): Promise<void> {
    await this.awaitCurrentExecution();
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    const session = this.sessions.current;
    if (!session || !isActiveMaintenanceSession(session)) {
      if (session) session.generation += 1;
      return;
    }

    const { session: stopping, generation } = this.sessions.beginStopping(session.id, INTERRUPTED);
    this.active?.executor.stop();
    await this.awaitCurrentExecution();
    if (!this.sessions.isCurrent(stopping.id, generation)) return;
    if (stopping.phase === "apply") await this.applyRunner.skipOutstanding(stopping.id, generation, INTERRUPTED);
    await this.finishSession(stopping.id, generation, "failed", INTERRUPTED);
  }

  private async startCurrentPhase(sessionId: string, generation: number, message?: string): Promise<void> {
    this.sessions.assertCurrent(sessionId, generation, ["queued", "paused"]);
    if (this.executionPromise) throw new Error("Maintenance coordinator already has an active executor");
    // The current configuration must be applied immediately before every
    // preview/apply execution (including a resumed one). Runtime test doubles
    // used by host tests may predate this optional capability.
    await this.runtime.applyNetworkPolicy?.();
    const session = this.sessions.start(sessionId, generation);
    await this.projector.taskStatus(session, "running", message ?? `Starting maintenance ${session.phase}`);

    const run =
      session.phase === "preview"
        ? this.previewRunner.run(sessionId, generation)
        : this.applyRunner.run(sessionId, generation);
    let tracked: Promise<void>;
    tracked = run.finally(() => {
      if (this.executionPromise === tracked) this.executionPromise = null;
      this.notify(sessionId);
    });
    this.executionPromise = tracked;
    void tracked.catch(() => undefined);
  }

  private async waitForApply(
    taskId: string,
    batchId: string,
    selectedIds: ReadonlySet<string>,
  ): Promise<MaintenanceApplyBatch> {
    for (;;) {
      const session = this.sessions.require(taskId);
      if (session.status === "completed" || session.status === "failed") {
        if (session.currentBatch?.id !== batchId) throw new Error("维护批次已变化");
        return {
          task: this.projector.task(session),
          batchId,
          items: this.projector.editablePreviews(session),
          applied: this.projector.applyLogs(session).filter((log) => selectedIds.has(log.previewId)),
        };
      }
      await this.waitForChange(taskId);
    }
  }

  private async finishSession(
    sessionId: string,
    generation: number,
    status: "completed" | "failed",
    error: string | null,
  ): Promise<void> {
    const session = this.sessions.finish(sessionId, generation, status, error);
    const message =
      session.phase === "preview"
        ? status === "failed"
          ? (error ?? "维护预览失败")
          : `Maintenance preview completed. Ready: ${session.progress.successCount}, Blocked: ${session.progress.failedCount}`
        : status === "failed"
          ? (error ?? APPLY_FAILED)
          : `Maintenance completed. Succeeded: ${session.progress.successCount}, Failed: ${session.progress.failedCount}`;
    await this.projector.taskStatus(session, status, message);
    if (status === "failed" && error) await this.projector.failed(session, error);
  }

  private async failSession(sessionId: string, generation: number, error: string): Promise<void> {
    const session = this.sessions.fail(sessionId, generation, error);
    if (!session) return;
    await this.projector.taskStatus(session, "failed", error);
    await this.projector.failed(session, error);
  }

  private activeFor(sessionId: string, generation: number): ActiveMaintenanceExecution | null {
    return this.active?.sessionId === sessionId && this.active.generation === generation ? this.active : null;
  }

  private notify(taskId: string): void {
    const waiters = this.changeWaiters.get(taskId);
    if (!waiters) return;
    this.changeWaiters.delete(taskId);
    for (const waiter of waiters) waiter();
  }

  private async waitForChange(taskId: string): Promise<void> {
    await new Promise<void>((resolve) => {
      const waiters = this.changeWaiters.get(taskId) ?? new Set<() => void>();
      let timer: ReturnType<typeof setTimeout>;
      const done = () => {
        clearTimeout(timer);
        waiters.delete(done);
        resolve();
      };
      waiters.add(done);
      this.changeWaiters.set(taskId, waiters);
      timer = setTimeout(done, 50);
    });
  }

  private async awaitCurrentExecution(): Promise<void> {
    for (;;) {
      const current = this.executionPromise;
      if (!current) return;
      await current.catch(() => undefined);
      if (this.executionPromise === current) return;
    }
  }

  private assertOpen(): void {
    if (this.closing) throw new Error("Maintenance coordinator is closed");
  }
}
