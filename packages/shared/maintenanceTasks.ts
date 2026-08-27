export type MaintenanceFieldSelectionSide = "old" | "new";

import type {
  CrawlerData,
  FieldDiff,
  LocalScanEntry,
  MaintenanceImageAlternatives,
  MaintenancePresetId,
  PathDiff,
} from "./types";

export type MaintenanceTaskStatus = "queued" | "running" | "paused" | "stopping" | "completed" | "failed";
export type MaintenanceTaskPhase = "preview" | "apply";

export interface MaintenanceTaskRef {
  relativePath: string;
}

export interface MaintenanceTaskProgress {
  totalEntries: number;
  completedEntries: number;
  successCount: number;
  failedCount: number;
}

export interface MaintenanceTaskSnapshot extends MaintenanceTaskProgress {
  id: string;
  rootId: string;
  status: MaintenanceTaskStatus;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
}

export type MaintenanceTaskPreviewStatus = "ready" | "blocked" | "applied" | "failed";

export interface MaintenanceTaskPreview {
  id: string;
  taskId: string;
  rootId: string;
  relativePath: string;
  presetId: MaintenancePresetId;
  status: MaintenanceTaskPreviewStatus;
  error: string | null;
  fieldDiffs: FieldDiff[];
  unchangedFieldDiffs: FieldDiff[];
  pathDiff: PathDiff | null;
  proposedCrawlerData: CrawlerData | null;
  imageAlternatives?: MaintenanceImageAlternatives;
  entry?: LocalScanEntry;
  librarySource?: MaintenanceLibrarySource;
  createdAt: Date;
  updatedAt: Date;
}

export type MaintenanceTaskApplyItemStatus = "pending" | "processing" | "success" | "failed" | "skipped";

export interface MaintenanceApplySelection {
  previewId: string;
  fieldSelections?: Record<string, MaintenanceFieldSelectionSide>;
}

export interface MaintenanceTaskApplyLog {
  id: string;
  taskId: string;
  batchId: string;
  previewId: string;
  rootId: string;
  relativePath: string;
  presetId: MaintenancePresetId;
  status: "success" | "failed" | "skipped";
  error: string | null;
  appliedAt: Date;
}

export interface MaintenanceTaskEvent {
  id: string;
  taskId: string;
  type: string;
  message: string;
  createdAt: Date;
}

export interface MaintenanceApplyItemResult {
  status: "success" | "failed" | "skipped";
  error?: string | null;
  entry?: LocalScanEntry;
  crawlerData?: CrawlerData;
  fieldDiffs?: FieldDiff[];
  unchangedFieldDiffs?: FieldDiff[];
  pathDiff?: PathDiff;
  outputRelativePath?: string;
  outputSize?: number;
  outputModifiedAt?: Date | null;
}

export interface MaintenancePreviewBatch {
  task: MaintenanceTaskSnapshot;
  items: MaintenanceTaskPreview[];
}

export interface MaintenanceApplyBatch {
  task: MaintenanceTaskSnapshot;
  batchId: string;
  items: MaintenanceTaskPreview[];
  applied: MaintenanceTaskApplyLog[];
}

export interface MaintenanceLibrarySource {
  libraryItemId: string;
  libraryFileId: string;
  rootId: string;
  rootRelativePath: string;
}

export interface MaintenanceSessionDraft {
  fieldSelections: Record<string, Record<string, MaintenanceFieldSelectionSide>>;
}

export interface MaintenanceActiveSessionSnapshot extends MaintenanceTaskProgress {
  id: string;
  rootId: string;
  presetId: MaintenancePresetId;
  phase: MaintenanceTaskPhase;
  status: MaintenanceTaskStatus;
  generation: number;
  refs: MaintenanceTaskRef[];
  timestamps: { createdAt: Date; updatedAt: Date; startedAt: Date | null; completedAt: Date | null };
  error: string | null;
  previews: MaintenanceTaskPreview[];
  currentBatch: {
    id: string;
    items: Array<{
      id: string;
      selection: MaintenanceApplySelection;
      status: MaintenanceTaskApplyItemStatus;
      error: string | null;
      result?: MaintenanceApplyItemResult;
      createdAt: Date;
      updatedAt: Date;
    }>;
  } | null;
  draft: MaintenanceSessionDraft;
}
