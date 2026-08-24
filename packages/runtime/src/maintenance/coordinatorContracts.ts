import type { MediaRoot } from "@mdcz/media-store";
import type {
  MaintenanceApplyItemResult,
  MaintenanceTaskApplyLog,
  MaintenanceTaskEvent,
  MaintenanceTaskPreview,
  MaintenanceTaskProgress,
  MaintenanceTaskSnapshot,
} from "@mdcz/shared/maintenanceTasks";
import type { CrawlerData, DiscoveredAssets, LocalScanEntry } from "@mdcz/shared/types";

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
