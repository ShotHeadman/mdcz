import path from "node:path";
import type { CrawlerDataDto, MaintenanceApplyLogDto, MaintenancePreviewItemDto } from "@mdcz/shared/serverDtos";
import type { MaintenancePresetId } from "@mdcz/shared/types";

export interface RuntimeMaintenancePreviewRecord {
  id: string;
  taskId: string;
  rootId: string;
  relativePath: string;
  presetId: string;
  status: "ready" | "blocked" | "applied" | "failed";
  error: string | null;
  fieldDiffsJson: string;
  unchangedFieldDiffsJson: string;
  pathDiffJson: string | null;
  proposedCrawlerDataJson: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RuntimeMaintenanceApplyLogRecord {
  id: string;
  taskId: string;
  previewId: string;
  rootId: string;
  relativePath: string;
  presetId: string;
  status: "success" | "failed" | "skipped";
  error: string | null;
  appliedAt: Date;
}

const parseJson = <T>(value: string): T => JSON.parse(value) as T;
const parseNullableJson = <T>(value: string | null): T | null => (value ? parseJson<T>(value) : null);

export const toMaintenancePreviewDto = (
  record: RuntimeMaintenancePreviewRecord,
  options: {
    rootDisplayName: string;
  },
): MaintenancePreviewItemDto => ({
  id: record.id,
  taskId: record.taskId,
  presetId: record.presetId as MaintenancePresetId,
  rootId: record.rootId,
  rootDisplayName: options.rootDisplayName,
  relativePath: record.relativePath,
  fileName: path.posix.basename(record.relativePath),
  status: record.status,
  error: record.error,
  fieldDiffs: parseJson(record.fieldDiffsJson),
  unchangedFieldDiffs: parseJson(record.unchangedFieldDiffsJson),
  pathDiff: parseNullableJson(record.pathDiffJson),
  proposedCrawlerData: parseNullableJson<CrawlerDataDto>(record.proposedCrawlerDataJson),
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
});

export const toMaintenanceApplyLogDto = (record: RuntimeMaintenanceApplyLogRecord): MaintenanceApplyLogDto => ({
  id: record.id,
  taskId: record.taskId,
  previewId: record.previewId,
  rootId: record.rootId,
  relativePath: record.relativePath,
  presetId: record.presetId as MaintenancePresetId,
  status: record.status,
  error: record.error,
  appliedAt: record.appliedAt.toISOString(),
});
