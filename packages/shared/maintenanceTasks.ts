import type { RootFileRef } from "./mediaRef";
import type {
  CrawlerData,
  FieldDiff,
  LocalScanEntry,
  MaintenanceImageAlternatives,
  MaintenancePresetId,
  PathDiff,
} from "./types";

export type MaintenanceFieldSelectionSide = "old" | "new";

export type MaintenanceSessionStatus = "queued" | "running" | "paused" | "stopping" | "completed" | "failed";
export type MaintenanceSessionPhase = "preview" | "apply";

export type MaintenanceSessionRef = RootFileRef;

export interface MaintenanceSessionProgress {
  totalEntries: number;
  completedEntries: number;
  successCount: number;
  failedCount: number;
}

export interface MaintenanceSessionSnapshot extends MaintenanceSessionProgress {
  id: string;
  rootId: string;
  status: MaintenanceSessionStatus;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
}

export type MaintenanceSessionPreviewStatus = "ready" | "blocked" | "applied" | "failed";

export interface MaintenanceSessionPreview {
  id: string;
  sessionId: string;
  rootId: string;
  relativePath: string;
  presetId: MaintenancePresetId;
  status: MaintenanceSessionPreviewStatus;
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

export type MaintenanceSessionApplyItemStatus = "pending" | "processing" | "success" | "failed" | "skipped";

export interface MaintenanceApplySelection {
  previewId: string;
  fieldSelections?: Record<string, MaintenanceFieldSelectionSide>;
}

export interface MaintenanceSessionApplyLog {
  id: string;
  sessionId: string;
  batchId: string;
  previewId: string;
  rootId: string;
  relativePath: string;
  presetId: MaintenancePresetId;
  status: "success" | "failed" | "skipped";
  error: string | null;
  appliedAt: Date;
}

export interface MaintenanceSessionEvent {
  id: string;
  sessionId: string;
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
  session: MaintenanceSessionSnapshot;
  items: MaintenanceSessionPreview[];
}

export interface MaintenanceApplyBatch {
  session: MaintenanceSessionSnapshot;
  batchId: string;
  items: MaintenanceSessionPreview[];
  applied: MaintenanceSessionApplyLog[];
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

export interface MaintenanceActiveSessionSnapshot extends MaintenanceSessionProgress {
  id: string;
  rootId: string;
  presetId: MaintenancePresetId;
  phase: MaintenanceSessionPhase;
  status: MaintenanceSessionStatus;
  generation: number;
  refs: MaintenanceSessionRef[];
  timestamps: { createdAt: Date; updatedAt: Date; startedAt: Date | null; completedAt: Date | null };
  error: string | null;
  previews: MaintenanceSessionPreview[];
  currentBatch: {
    id: string;
    items: Array<{
      id: string;
      selection: MaintenanceApplySelection;
      status: MaintenanceSessionApplyItemStatus;
      error: string | null;
      result?: MaintenanceApplyItemResult;
      createdAt: Date;
      updatedAt: Date;
    }>;
  } | null;
  draft: MaintenanceSessionDraft;
}
