import type { ScrapeResult, ScraperStatus } from "@shared/types";
import { createIdleScraperStatus, type PersistedSessionState, SessionFileState, type SessionState } from "./types";

interface ApplyResultOutcome {
  failureMembershipChanged: boolean;
}

const isFailedState = (state: SessionFileState | undefined): boolean =>
  state === SessionFileState.Failed || state === SessionFileState.RetryPending;

const isPendingState = (state: SessionFileState | undefined): boolean =>
  state === SessionFileState.Pending || state === SessionFileState.RetryPending;

export class SessionProgressTracker {
  private sessionState: SessionState = "idle";

  private status: ScraperStatus = createIdleScraperStatus();

  private readonly fileStates = new Map<string, SessionFileState>();

  getState(): SessionState {
    return this.sessionState;
  }

  getStatus(): ScraperStatus {
    return { ...this.status };
  }

  begin(files: string[]): void {
    this.sessionState = "running";
    this.status = {
      state: "running",
      running: true,
      totalFiles: files.length,
      completedFiles: 0,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
    };

    this.fileStates.clear();
    for (const file of files) {
      this.fileStates.set(file, SessionFileState.Pending);
    }
  }

  transitionTo(nextState: SessionState): void {
    this.sessionState = nextState;
    this.status = {
      ...this.status,
      state: nextState,
      running: nextState !== "idle",
    };
  }

  finish(): void {
    for (const [filePath, state] of this.fileStates) {
      if (state === SessionFileState.Pending) {
        this.fileStates.delete(filePath);
        continue;
      }

      if (state === SessionFileState.RetryPending) {
        this.fileStates.set(filePath, SessionFileState.Failed);
      }
    }

    this.transitionTo("idle");
  }

  queueRetry(sourcePath: string): boolean {
    if (this.fileStates.get(sourcePath) !== SessionFileState.Failed) {
      return false;
    }

    this.fileStates.set(sourcePath, SessionFileState.RetryPending);
    return true;
  }

  applyResult(sourcePath: string, result: ScrapeResult, isRetry: boolean): ApplyResultOutcome {
    const previousState = this.fileStates.get(sourcePath);
    const hadFailureBefore = isFailedState(previousState);

    if (!isRetry) {
      this.status = {
        ...this.status,
        completedFiles: this.status.completedFiles + 1,
      };
    }

    if (result.status === "success") {
      this.status.successCount += 1;
      this.fileStates.delete(sourcePath);
      if (hadFailureBefore) {
        this.status.failedCount = Math.max(0, this.status.failedCount - 1);
      }
    } else if (result.status === "failed") {
      this.fileStates.set(sourcePath, SessionFileState.Failed);
      if (!hadFailureBefore) {
        this.status.failedCount += 1;
      }
    } else {
      this.status.skippedCount += 1;
      this.fileStates.delete(sourcePath);
      if (hadFailureBefore) {
        this.status.failedCount = Math.max(0, this.status.failedCount - 1);
      }
    }

    return {
      failureMembershipChanged: hadFailureBefore !== isFailedState(this.fileStates.get(sourcePath)),
    };
  }

  getFailedFiles(): string[] {
    return this.collectFiles(isFailedState);
  }

  getPendingFiles(): string[] {
    return this.collectFiles(isPendingState);
  }

  buildSnapshot(taskId: string): PersistedSessionState {
    return {
      taskId,
      status: this.getStatus(),
      failedFiles: this.getFailedFiles(),
      pendingFiles: this.getPendingFiles(),
    };
  }

  private collectFiles(predicate: (state: SessionFileState | undefined) => boolean): string[] {
    const files: string[] = [];
    for (const [filePath, state] of this.fileStates) {
      if (predicate(state)) {
        files.push(filePath);
      }
    }
    return files;
  }
}
