import type { MediaRoot } from "@mdcz/media-store";
import type {
  MaintenanceActiveSessionSnapshot,
  MaintenanceApplyItemResult,
  MaintenanceApplySelection,
  MaintenanceExecutionOwner,
  MaintenanceExecutionState,
  MaintenanceTaskApplyLog,
  MaintenanceTaskApplyQueueItem,
  MaintenanceTaskClaim,
  MaintenanceTaskEvent,
  MaintenanceTaskPatch,
  MaintenanceTaskPreview,
  MaintenanceTaskProgress,
  MaintenanceTaskRef,
  MaintenanceTaskSnapshot,
  MaintenanceTaskStatus,
} from "@mdcz/shared/maintenanceTasks";
import type { CrawlerData, DiscoveredAssets, LocalScanEntry, MaintenancePresetId } from "@mdcz/shared/types";

export interface MaintenanceTaskStore {
  createPreviewExecution(input: {
    rootId: string;
    presetId: MaintenancePresetId;
    refs?: readonly MaintenanceTaskRef[];
  }): Promise<MaintenanceTaskSnapshot>;
  claimNext(): Promise<MaintenanceTaskClaim | null>;
  readTask(taskId: string): Promise<MaintenanceTaskSnapshot>;
  listTasks(): Promise<MaintenanceTaskSnapshot[]>;
  readExecution(taskId: string): Promise<MaintenanceExecutionState>;
  listPreviews(taskId: string): Promise<MaintenanceTaskPreview[]>;
  listPendingApplyItems(taskId: string): Promise<MaintenanceTaskApplyQueueItem[]>;
  listApplyLogs(taskId: string): Promise<MaintenanceTaskApplyLog[]>;
  listEvents(taskId: string): Promise<MaintenanceTaskEvent[]>;
  persistDiscoveredRefs(
    owner: MaintenanceExecutionOwner,
    refs: readonly MaintenanceTaskRef[],
  ): Promise<MaintenanceTaskSnapshot | null>;
  commitPreviewItem(
    owner: MaintenanceExecutionOwner,
    input: { preview: MaintenanceTaskPreview; progress: MaintenanceTaskProgress },
  ): Promise<MaintenanceTaskPreview | null>;
  queueApply(input: {
    taskId: string;
    expectedExecutionVersion: number;
    selections: readonly MaintenanceApplySelection[];
    patch: MaintenanceTaskPatch;
  }): Promise<MaintenanceTaskSnapshot | null>;
  markApplyItemProcessing(owner: MaintenanceExecutionOwner, itemId: string): Promise<boolean>;
  commitApplyItem(
    owner: MaintenanceExecutionOwner,
    itemId: string,
    result: MaintenanceApplyItemResult,
  ): Promise<MaintenanceTaskApplyLog | null>;
  transition(input: {
    owner: MaintenanceExecutionOwner;
    expectedStatus: MaintenanceTaskStatus | readonly MaintenanceTaskStatus[];
    patch: MaintenanceTaskPatch;
  }): Promise<MaintenanceTaskSnapshot | null>;
  failInterruptedApply(owner: MaintenanceExecutionOwner, error: string): Promise<MaintenanceTaskSnapshot | null>;
  getActiveSession(): Promise<MaintenanceActiveSessionSnapshot | null>;
  updateDraft(input: {
    taskId: string;
    previewId: string;
    fieldSelections?: Record<string, import("@mdcz/shared/maintenanceCommit").MaintenanceFieldSelectionSide>;
    imageSelections?: Record<string, string>;
  }): Promise<MaintenanceActiveSessionSnapshot>;
  discardSession(taskId?: string): Promise<void>;
}

export interface MaintenanceRootPort {
  getActiveRoot(rootId: string): Promise<MediaRoot>;
}

export interface MaintenanceLibraryPort {
  resolveSource(absolutePath: string): Promise<import("@mdcz/shared/maintenanceTasks").MaintenanceLibrarySource | null>;
  preflightRefresh(input: {
    librarySource?: import("@mdcz/shared/maintenanceTasks").MaintenanceLibrarySource;
    sourceAbsolutePath: string;
    targetAbsolutePath: string;
  }): Promise<void>;
  commitRefresh(input: {
    librarySource?: import("@mdcz/shared/maintenanceTasks").MaintenanceLibrarySource;
    sourceAbsolutePath: string;
    targetAbsolutePath: string;
    size: number;
    modifiedAt: Date;
    crawlerData?: CrawlerData;
    fallbackNumber: string;
    assets: DiscoveredAssets;
    refreshedAt: Date;
  }): Promise<{ libraryItemId: string }>;
}

export type MaintenanceCoordinatorEvent =
  | { kind: "task-changed"; task: MaintenanceTaskSnapshot }
  | { kind: "log"; taskId: string; event: MaintenanceTaskEvent }
  | {
      kind: "progress";
      taskId: string;
      phase: "preview" | "apply";
      progress: MaintenanceTaskProgress;
      message?: string;
    }
  | { kind: "preview-item"; taskId: string; preview: MaintenanceTaskPreview; entry: LocalScanEntry }
  | { kind: "apply-item"; taskId: string; log: MaintenanceTaskApplyLog; result: MaintenanceApplyItemResult }
  | { kind: "task-failed"; taskId: string; error: string };

export interface MaintenanceCoordinatorEventSink {
  publish(event: MaintenanceCoordinatorEvent): void | Promise<void>;
}

export interface MaintenanceRunHandle<TResult> {
  task: MaintenanceTaskSnapshot;
  completion: Promise<TResult>;
}

export const noopMaintenanceCoordinatorEventSink: MaintenanceCoordinatorEventSink = {
  publish: () => undefined,
};
