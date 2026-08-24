import type { MaintenanceActiveSessionSnapshot, MaintenanceTaskPreview } from "@mdcz/shared/maintenanceTasks";
import type { CrawlerData, LocalScanEntry } from "@mdcz/shared/types";
import { describe, expect, it } from "vitest";
import { toMaintenanceClientSession } from "./clientSession";

const now = new Date("2026-08-24T00:00:00.000Z");
const crawlerData: CrawlerData = {
  title: "New title",
  number: "ABC-001",
  actors: [],
  genres: [],
  scene_images: [],
};
const titleDiff = {
  kind: "value" as const,
  field: "title" as const,
  label: "标题",
  oldValue: "Old",
  newValue: "New",
  changed: true,
};
const numberDiff = {
  kind: "value" as const,
  field: "number" as const,
  label: "番号",
  oldValue: "ABC-001",
  newValue: "ABC-001",
  changed: false,
};

const entry = (fileId: string, relativePath: string): LocalScanEntry => ({
  fileId,
  rootRef: { rootId: "root-1", relativePath },
  fileInfo: {
    filePath: `/media/${relativePath}`,
    fileName: relativePath,
    extension: ".mp4",
    number: "ABC-001",
    isSubtitled: false,
  },
  assets: { sceneImages: [], actorPhotos: [] },
  currentDir: "/media",
});

const editablePreview: MaintenanceTaskPreview = {
  id: "preview-editable",
  taskId: "task-1",
  rootId: "root-1",
  relativePath: "editable.mp4",
  presetId: "refresh_data",
  status: "ready",
  error: null,
  fieldDiffs: [titleDiff],
  unchangedFieldDiffs: [],
  pathDiff: null,
  proposedCrawlerData: crawlerData,
  entry: entry("desktop-editable", "editable.mp4"),
  createdAt: now,
  updatedAt: now,
};

const snapshot: MaintenanceActiveSessionSnapshot = {
  task: {
    id: "task-1",
    rootId: "root-1",
    status: "paused",
    totalEntries: 2,
    completedEntries: 1,
    successCount: 1,
    failedCount: 0,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    completedAt: null,
    error: null,
  },
  execution: {
    taskId: "task-1",
    presetId: "refresh_data",
    phase: "apply",
    batchId: "batch-1",
    refs: [{ relativePath: "editable.mp4" }, { relativePath: "finished.mp4" }],
    totalEntries: 2,
    completedEntries: 1,
    successCount: 1,
    failedCount: 0,
    createdAt: now,
    updatedAt: now,
  },
  previews: [editablePreview],
  applyItems: [
    {
      id: "apply-pending",
      taskId: "task-1",
      batchId: "batch-1",
      previewId: editablePreview.id,
      status: "pending",
      fieldSelections: { title: "new" },
      error: null,
      createdAt: now,
      updatedAt: now,
    },
  ],
  draft: {
    fieldSelections: { [editablePreview.id]: { title: "new" } },
    imageSelections: { [editablePreview.id]: { poster_url: "poster.jpg" } },
  },
  recentBatch: {
    batchId: "batch-1",
    items: [
      {
        log: {
          id: "apply-finished",
          taskId: "task-1",
          batchId: "batch-1",
          previewId: "preview-finished",
          rootId: "root-1",
          relativePath: "finished.mp4",
          presetId: "refresh_data",
          status: "success",
          error: null,
          appliedAt: now,
        },
        result: {
          status: "success",
          crawlerData,
          entry: entry("desktop-finished", "finished.mp4"),
          fieldDiffs: [titleDiff],
          unchangedFieldDiffs: [numberDiff],
          pathDiff: {
            fileId: "desktop-finished",
            currentVideoPath: "/media/old.mp4",
            targetVideoPath: "/media/finished.mp4",
            currentDir: "/media",
            targetDir: "/media",
            changed: true,
          },
        },
      },
    ],
  },
};

const desktopHost = {
  fileId: (preview: MaintenanceTaskPreview, current: LocalScanEntry | null): string =>
    current?.fileId ?? preview.relativePath,
  toEntry: (preview: MaintenanceTaskPreview, fileId: string): LocalScanEntry | null =>
    preview.entry ? { ...preview.entry, fileId } : null,
};

const serverHost = {
  fileId: (preview: MaintenanceTaskPreview): string => `${preview.rootId}:${preview.relativePath}`,
  toEntry: (preview: MaintenanceTaskPreview, fileId: string): LocalScanEntry | null =>
    preview.entry
      ? {
          ...preview.entry,
          fileId,
          rootRef: { rootId: preview.rootId, relativePath: preview.relativePath },
        }
      : null,
};

describe("toMaintenanceClientSession", () => {
  it("returns null for a new backend without a session", () => {
    expect(toMaintenanceClientSession(null, desktopHost)).toBeNull();
  });

  it("keeps Desktop and Server session structure identical apart from file identity rules", () => {
    const desktop = toMaintenanceClientSession(snapshot, desktopHost);
    const server = toMaintenanceClientSession(snapshot, serverHost);

    expect(desktop).toMatchObject({
      taskId: "task-1",
      batchId: "batch-1",
      status: { state: "paused", totalEntries: 2, completedEntries: 1, successCount: 1, failedCount: 0 },
      fieldSelections: { "desktop-editable": { title: "new" } },
      imageSelections: { "desktop-editable": { poster_url: "poster.jpg" } },
      currentResults: [{ fileId: "desktop-editable", batchId: "batch-1", status: "pending" }],
    });
    expect(desktop?.recentResults[0]).toMatchObject({
      fileId: "desktop-finished",
      batchId: "batch-1",
      status: "success",
      crawlerData,
      updatedEntry: { fileId: "desktop-finished" },
      fieldDiffs: snapshot.recentBatch?.items[0]?.result.fieldDiffs,
      unchangedFieldDiffs: snapshot.recentBatch?.items[0]?.result.unchangedFieldDiffs,
      pathDiff: snapshot.recentBatch?.items[0]?.result.pathDiff,
    });
    expect(server).toMatchObject({
      taskId: desktop?.taskId,
      batchId: desktop?.batchId,
      presetId: desktop?.presetId,
      status: desktop?.status,
      fieldSelections: { "root-1:editable.mp4": { title: "new" } },
      imageSelections: { "root-1:editable.mp4": { poster_url: "poster.jpg" } },
      currentResults: [{ fileId: "root-1:editable.mp4", batchId: "batch-1", status: "pending" }],
      recentResults: [
        {
          ...desktop?.recentResults[0],
          fileId: "root-1:finished.mp4",
          updatedEntry: {
            ...desktop?.recentResults[0]?.updatedEntry,
            fileId: "root-1:finished.mp4",
            rootRef: { rootId: "root-1", relativePath: "finished.mp4" },
          },
        },
      ],
    });
  });
});
