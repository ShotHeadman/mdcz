import type { MaintenanceActiveSessionSnapshot } from "@mdcz/shared/maintenanceTasks";
import type { LocalScanEntry, MaintenanceStatus } from "@mdcz/shared/types";
import {
  applyMaintenanceExecutionItemResult,
  applyMaintenancePreviewResult,
  applyMaintenanceSessionSnapshot,
  beginMaintenancePreviewRequest,
  cancelMaintenancePreviewFlow,
  changeMaintenancePreset,
  clearMaintenancePreviewResults,
  invalidateMaintenancePreview,
  toggleMaintenanceSelectedIds,
  useMaintenanceStore,
} from "@mdcz/views/state/maintenanceStore";
import { afterEach, describe, expect, it } from "vitest";
import { buildMaintenanceEntryGroups, findMaintenanceEntryGroup } from "@/lib/maintenanceGrouping";
import {
  createMaintenanceCrawlerData,
  createMaintenanceEntry,
  createMaintenanceValueDiff,
} from "./maintenanceTestSupport";

const sessionSnapshot = (
  entries: LocalScanEntry[],
  status: MaintenanceStatus,
  options: {
    fieldSelections?: MaintenanceActiveSessionSnapshot["draft"]["fieldSelections"];
    imageSelections?: MaintenanceActiveSessionSnapshot["draft"]["imageSelections"];
    pendingPreviewId?: string;
  } = {},
): MaintenanceActiveSessionSnapshot => ({
  id: "task-1",
  rootId: "root-1",
  presetId: "refresh_data",
  phase: options.pendingPreviewId ? "apply" : "preview",
  status:
    status.state === "paused"
      ? "paused"
      : status.state === "stopping"
        ? "stopping"
        : status.state === "idle"
          ? "completed"
          : "running",
  generation: 1,
  refs: entries.map((entry) => ({ relativePath: entry.fileInfo.filePath })),
  timestamps: { createdAt: new Date(0), updatedAt: new Date(0), startedAt: new Date(0), completedAt: null },
  error: null,
  previews: entries.map((entry, index) => ({
    id: `preview-${index + 1}`,
    taskId: "task-1",
    rootId: "root-1",
    relativePath: entry.fileInfo.filePath,
    presetId: "refresh_data",
    status: "ready",
    error: null,
    fieldDiffs: [],
    unchangedFieldDiffs: [],
    pathDiff: null,
    proposedCrawlerData: null,
    entry,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  })),
  currentBatch: options.pendingPreviewId
    ? {
        id: "batch-1",
        items: [
          {
            id: "batch-item-1",
            selection: { previewId: options.pendingPreviewId },
            status: "pending",
            error: null,
            createdAt: new Date(0),
            updatedAt: new Date(0),
          },
        ],
      }
    : null,
  draft: {
    fieldSelections: options.fieldSelections ?? {},
    imageSelections: options.imageSelections ?? {},
  },
  totalEntries: status.totalEntries,
  completedEntries: status.completedEntries,
  successCount: status.successCount,
  failedCount: status.failedCount,
});

afterEach(() => {
  useMaintenanceStore.getState().reset();
  useMaintenanceStore.getState().reset();
  useMaintenanceStore.getState().reset();
});

describe("maintenance execution stores", () => {
  it("hydrates an active snapshot and removes terminal events idempotently without touching unselected items", () => {
    const first = createMaintenanceEntry();
    const second: LocalScanEntry = {
      ...createMaintenanceEntry(),
      fileId: "entry-2",
      fileInfo: {
        ...createMaintenanceEntry().fileInfo,
        filePath: "/media/ABC-124.mp4",
        fileName: "ABC-124.mp4",
        number: "ABC-124",
      },
    };
    applyMaintenanceSessionSnapshot(
      sessionSnapshot(
        [first, second],
        {
          state: "idle",
          totalEntries: 1,
          completedEntries: 1,
          successCount: 0,
          failedCount: 1,
        },
        {
          fieldSelections: { "preview-1": { title: "old" }, "preview-2": { title: "new" } },
          imageSelections: { "preview-1": { poster: "old.jpg" }, "preview-2": { poster: "new.jpg" } },
        },
      ),
    );
    const result = { fileId: "entry-1", batchId: "batch-1", status: "failed" as const, error: "boom" };
    applyMaintenanceExecutionItemResult(result);
    applyMaintenanceExecutionItemResult(result);
    expect(useMaintenanceStore.getState()).toMatchObject({
      entries: [second],
      selectedIds: ["entry-2"],
      activeId: "entry-2",
    });
    expect(useMaintenanceStore.getState()).toMatchObject({
      previewResults: { "entry-2": expect.objectContaining({ previewId: "preview-2" }) },
      fieldSelections: { "entry-2": { title: "new" } },
      imageSelections: { "entry-2": { poster: "new.jpg" } },
    });
    expect(useMaintenanceStore.getState().itemResults).toEqual({ "entry-1": result });
  });

  it("restores only the current batch selection and its pending state", () => {
    const first = createMaintenanceEntry();
    const second: LocalScanEntry = {
      ...createMaintenanceEntry(),
      fileId: "entry-2",
      fileInfo: { ...createMaintenanceEntry().fileInfo, filePath: "/media/ABC-124.mp4" },
    };
    applyMaintenanceSessionSnapshot(
      sessionSnapshot(
        [first, second],
        {
          state: "paused",
          totalEntries: 1,
          completedEntries: 0,
          successCount: 0,
          failedCount: 0,
        },
        { pendingPreviewId: "preview-1" },
      ),
    );

    expect(useMaintenanceStore.getState().selectedIds).toEqual([first.fileId]);
    expect(useMaintenanceStore.getState()).toMatchObject({
      activeBatchId: "batch-1",
      itemResults: { [first.fileId]: { fileId: first.fileId, batchId: "batch-1", status: "pending" } },
    });
  });

  it("preserves preview diffs during optimistic execution and can roll back execution state", () => {
    const fieldDiff = createMaintenanceValueDiff({
      field: "title" as const,
      label: "标题",
      oldValue: "Old Title",
      newValue: "New Title",
      changed: true,
    });
    const unchangedFieldDiff = createMaintenanceValueDiff({
      field: "actors" as const,
      label: "演员",
      oldValue: ["Actor A"],
      newValue: ["Actor A"],
      changed: false,
    });
    const pathDiff = {
      fileId: "entry-1",
      currentVideoPath: "/media/ABC-123.mp4",
      targetVideoPath: "/organized/ABC-123.mp4",
      currentDir: "/media",
      targetDir: "/organized",
      changed: true,
    };
    const previewResults = {
      "entry-1": {
        fileId: "entry-1",
        status: "ready" as const,
        fieldDiffs: [fieldDiff],
        unchangedFieldDiffs: [unchangedFieldDiff],
        pathDiff,
      },
    };

    useMaintenanceStore.getState().setEntries([createMaintenanceEntry(createMaintenanceCrawlerData())], "/media");
    useMaintenanceStore.getState().beginExecution({
      fileIds: ["entry-1"],
    });
    applyMaintenanceExecutionItemResult({
      fileId: "entry-1",
      status: "processing",
    });

    expect(useMaintenanceStore.getState().itemResults["entry-1"]).toEqual({
      fileId: "entry-1",
      status: "processing",
    });

    const compareGroup = buildMaintenanceEntryGroups([createMaintenanceEntry(createMaintenanceCrawlerData())], {
      itemResults: useMaintenanceStore.getState().itemResults,
      previewResults,
    })[0];
    expect(compareGroup?.compareResult).toMatchObject({
      fileId: "entry-1",
      fieldDiffs: [fieldDiff],
      unchangedFieldDiffs: [unchangedFieldDiff],
      pathDiff,
    });

    useMaintenanceStore.getState().rollbackExecutionStart();

    expect(useMaintenanceStore.getState().executionStatus).toBe("idle");
    expect(useMaintenanceStore.getState().progressTotal).toBe(0);
    expect(useMaintenanceStore.getState().itemResults).toEqual({});
  });
});

describe("maintenance preview store", () => {
  it("keeps preview refresh state separate from full invalidation", () => {
    useMaintenanceStore.setState({
      executionStatus: "idle",
      progressValue: 100,
      progressCurrent: 1,
      progressTotal: 1,
      itemResults: {
        "entry-1": {
          fileId: "entry-1",
          status: "success",
        },
      },
    });
    useMaintenanceStore.setState({
      previewPending: false,
      executeDialogOpen: true,
      previewResults: {
        "entry-1": {
          fileId: "entry-1",
          status: "ready",
        },
      },
      fieldSelections: {
        "entry-1": {
          title: "new",
        },
      },
    });

    beginMaintenancePreviewRequest();

    expect(useMaintenanceStore.getState().previewPending).toBe(true);
    expect(useMaintenanceStore.getState().executeDialogOpen).toBe(false);
    expect(useMaintenanceStore.getState().itemResults).toEqual({
      "entry-1": {
        fileId: "entry-1",
        status: "success",
      },
    });

    clearMaintenancePreviewResults();

    expect(useMaintenanceStore.getState().previewPending).toBe(false);
    expect(useMaintenanceStore.getState().executeDialogOpen).toBe(false);
    expect(useMaintenanceStore.getState().previewResults).toEqual({});
    expect(useMaintenanceStore.getState().fieldSelections).toEqual({});
    expect(useMaintenanceStore.getState().itemResults).toEqual({
      "entry-1": {
        fileId: "entry-1",
        status: "success",
      },
    });
    useMaintenanceStore.setState({
      previewPending: true,
      executeDialogOpen: true,
      previewResults: {
        "entry-1": {
          fileId: "entry-1",
          status: "ready",
        },
      },
      fieldSelections: {
        "entry-1": {
          title: "new",
        },
      },
    });

    useMaintenanceStore.getState().setEntries([createMaintenanceEntry(createMaintenanceCrawlerData())], "/media");
    invalidateMaintenancePreview();

    expect(useMaintenanceStore.getState().itemResults).toEqual({});
    expect(useMaintenanceStore.getState().previewPending).toBe(false);
    expect(useMaintenanceStore.getState().executeDialogOpen).toBe(false);
    expect(useMaintenanceStore.getState().previewResults).toEqual({});
    expect(useMaintenanceStore.getState().fieldSelections).toEqual({});
  });

  it("retargets the active entry to the latest preview set and exposes preview diffs instead of stale execution results", () => {
    const firstEntry = createMaintenanceEntry(createMaintenanceCrawlerData());
    const secondEntry: LocalScanEntry = {
      ...createMaintenanceEntry(
        createMaintenanceCrawlerData({ number: "ABC-124", title: "Another Title", title_zh: "另一个标题" }),
      ),
      fileId: "entry-2",
      fileInfo: {
        ...createMaintenanceEntry().fileInfo,
        filePath: "/media/ABC-124.mp4",
        fileName: "ABC-124.mp4",
        number: "ABC-124",
      },
      nfoPath: "/media/ABC-124.nfo",
    };

    useMaintenanceStore.getState().setEntries([firstEntry, secondEntry], "/media");
    useMaintenanceStore.getState().setActiveId("entry-2");
    useMaintenanceStore.setState({
      executionStatus: "idle",
      progressValue: 100,
      progressCurrent: 1,
      progressTotal: 1,
      itemResults: {
        "entry-1": {
          fileId: "entry-1",
          status: "failed",
          error: "旧执行结果",
        },
      },
    });

    applyMaintenancePreviewResult({
      items: [
        {
          fileId: "entry-1",
          status: "ready",
          fieldDiffs: [
            createMaintenanceValueDiff({
              field: "title",
              label: "标题",
              oldValue: "Old Title",
              newValue: "New Title",
              changed: true,
            }),
          ],
        },
      ],
    });

    const entryState = useMaintenanceStore.getState();
    const executionState = useMaintenanceStore.getState();
    const previewState = useMaintenanceStore.getState();
    const group = findMaintenanceEntryGroup(entryState.entries, "entry-1", {
      itemResults: executionState.itemResults,
      previewResults: previewState.previewResults,
    });

    expect(entryState.activeId).toBe("entry-1");
    expect(executionState.itemResults).toEqual({});
    expect(group?.compareResult).toMatchObject({
      fileId: "entry-1",
      status: "ready",
    });
  });

  it("invalidates preview state when selection changes under non-diff presets", () => {
    useMaintenanceStore.getState().setEntries(
      [
        createMaintenanceEntry(createMaintenanceCrawlerData()),
        {
          ...createMaintenanceEntry(createMaintenanceCrawlerData({ number: "ABC-124" })),
          fileId: "entry-2",
        },
      ],
      "/media",
    );
    useMaintenanceStore.setState({
      executionStatus: "idle",
      progressValue: 100,
      progressCurrent: 1,
      progressTotal: 1,
      itemResults: {
        "entry-1": {
          fileId: "entry-1",
          status: "success",
        },
      },
    });
    useMaintenanceStore.setState({
      previewPending: false,
      executeDialogOpen: true,
      previewResults: {
        "entry-1": {
          fileId: "entry-1",
          status: "ready",
        },
      },
      fieldSelections: {
        "entry-1": {
          title: "new",
        },
      },
    });

    toggleMaintenanceSelectedIds(["entry-2"]);

    expect(useMaintenanceStore.getState().selectedIds).toEqual(["entry-1"]);
    expect(useMaintenanceStore.getState().previewResults).toEqual({});
    expect(useMaintenanceStore.getState().itemResults).toEqual({});
  });

  it("preserves preview state when selection changes under diff presets", () => {
    useMaintenanceStore.getState().setEntries(
      [
        createMaintenanceEntry(createMaintenanceCrawlerData()),
        {
          ...createMaintenanceEntry(createMaintenanceCrawlerData({ number: "ABC-124" })),
          fileId: "entry-2",
        },
      ],
      "/media",
    );
    useMaintenanceStore.getState().setPresetId("refresh_data");
    useMaintenanceStore.setState({
      executionStatus: "idle",
      progressValue: 100,
      progressCurrent: 1,
      progressTotal: 1,
      itemResults: {
        "entry-1": {
          fileId: "entry-1",
          status: "success",
        },
      },
    });
    useMaintenanceStore.setState({
      previewPending: false,
      executeDialogOpen: true,
      previewResults: {
        "entry-1": {
          fileId: "entry-1",
          status: "ready",
        },
      },
      fieldSelections: {
        "entry-1": {
          title: "new",
        },
      },
    });

    toggleMaintenanceSelectedIds(["entry-2"]);

    expect(useMaintenanceStore.getState().selectedIds).toEqual(["entry-1"]);
    expect(useMaintenanceStore.getState().previewResults).toEqual({
      "entry-1": {
        fileId: "entry-1",
        status: "ready",
      },
    });
    expect(useMaintenanceStore.getState().itemResults).toEqual({
      "entry-1": {
        fileId: "entry-1",
        status: "success",
      },
    });
  });

  it("invalidates preview state when preset changes", () => {
    useMaintenanceStore.getState().setEntries([createMaintenanceEntry(createMaintenanceCrawlerData())], "/media");
    useMaintenanceStore.getState().setPresetId("refresh_data");
    useMaintenanceStore.setState({
      previewPending: false,
      executeDialogOpen: true,
      previewResults: {
        "entry-1": {
          fileId: "entry-1",
          status: "ready",
        },
      },
      fieldSelections: {
        "entry-1": {
          title: "new",
        },
      },
    });

    changeMaintenancePreset("organize_files");

    expect(useMaintenanceStore.getState().presetId).toBe("organize_files");
    expect(useMaintenanceStore.getState().previewResults).toEqual({});
  });

  it("resets preview flow back to idle state when previewing is canceled", () => {
    useMaintenanceStore.getState().setEntries([createMaintenanceEntry(createMaintenanceCrawlerData())], "/media");
    useMaintenanceStore.setState({
      executionStatus: "previewing",
      progressValue: 37,
      progressCurrent: 1,
      progressTotal: 3,
      itemResults: {},
    });
    useMaintenanceStore.setState({
      previewPending: true,
      executeDialogOpen: false,
      previewResults: {
        "entry-1": {
          fileId: "entry-1",
          status: "ready",
        },
      },
      fieldSelections: {
        "entry-1": {
          title: "new",
        },
      },
    });

    cancelMaintenancePreviewFlow();

    expect(useMaintenanceStore.getState()).toMatchObject({
      executionStatus: "idle",
      progressValue: 0,
      progressCurrent: 0,
      progressTotal: 0,
      itemResults: {},
    });
    expect(useMaintenanceStore.getState().previewResults).toEqual({});
    expect(useMaintenanceStore.getState().fieldSelections).toEqual({});
  });
});
