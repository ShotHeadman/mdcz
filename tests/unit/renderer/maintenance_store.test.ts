import type { LocalScanEntry } from "@mdcz/shared/types";
import { useMaintenanceEntryStore } from "@mdcz/views/state/maintenanceEntryStore";
import { useMaintenanceExecutionStore } from "@mdcz/views/state/maintenanceExecutionStore";
import { useMaintenancePreviewStore } from "@mdcz/views/state/maintenancePreviewStore";
import {
  applyMaintenanceExecutionItemResult,
  applyMaintenancePreviewResult,
  cancelMaintenancePreviewFlow,
  changeMaintenancePreset,
  clearMaintenancePreviewResults,
  invalidateMaintenancePreview,
  toggleMaintenanceSelectedIds,
} from "@mdcz/views/state/maintenanceSession";
import { afterEach, describe, expect, it } from "vitest";
import { buildMaintenanceEntryGroups, findMaintenanceEntryGroup } from "@/lib/maintenanceGrouping";
import {
  createMaintenanceCrawlerData,
  createMaintenanceEntry,
  createMaintenanceValueDiff,
} from "./maintenanceTestSupport";

afterEach(() => {
  useMaintenancePreviewStore.getState().reset();
  useMaintenanceExecutionStore.getState().reset();
  useMaintenanceEntryStore.getState().reset();
});

describe("maintenance execution stores", () => {
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

    useMaintenanceEntryStore.getState().setEntries([createMaintenanceEntry(createMaintenanceCrawlerData())], "/media");
    useMaintenanceExecutionStore.getState().beginExecution({
      fileIds: ["entry-1"],
    });
    applyMaintenanceExecutionItemResult({
      fileId: "entry-1",
      status: "processing",
    });

    expect(useMaintenanceExecutionStore.getState().itemResults["entry-1"]).toEqual({
      fileId: "entry-1",
      status: "processing",
    });

    const compareGroup = buildMaintenanceEntryGroups([createMaintenanceEntry(createMaintenanceCrawlerData())], {
      itemResults: useMaintenanceExecutionStore.getState().itemResults,
      previewResults,
    })[0];
    expect(compareGroup?.compareResult).toMatchObject({
      fileId: "entry-1",
      fieldDiffs: [fieldDiff],
      unchangedFieldDiffs: [unchangedFieldDiff],
      pathDiff,
    });

    useMaintenanceExecutionStore.getState().rollbackExecutionStart();

    expect(useMaintenanceExecutionStore.getState().executionStatus).toBe("idle");
    expect(useMaintenanceExecutionStore.getState().progressTotal).toBe(0);
    expect(useMaintenanceExecutionStore.getState().itemResults).toEqual({});
  });
});

describe("maintenance preview store", () => {
  it("keeps preview refresh state separate from full invalidation", () => {
    useMaintenanceExecutionStore.setState({
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
    useMaintenancePreviewStore.setState({
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

    useMaintenancePreviewStore.getState().beginPreviewRequest();

    expect(useMaintenancePreviewStore.getState().previewPending).toBe(true);
    expect(useMaintenancePreviewStore.getState().executeDialogOpen).toBe(false);
    expect(useMaintenanceExecutionStore.getState().itemResults).toEqual({
      "entry-1": {
        fileId: "entry-1",
        status: "success",
      },
    });

    clearMaintenancePreviewResults();

    expect(useMaintenancePreviewStore.getState().previewPending).toBe(false);
    expect(useMaintenancePreviewStore.getState().executeDialogOpen).toBe(false);
    expect(useMaintenancePreviewStore.getState().previewResults).toEqual({});
    expect(useMaintenancePreviewStore.getState().fieldSelections).toEqual({});
    expect(useMaintenanceExecutionStore.getState().itemResults).toEqual({
      "entry-1": {
        fileId: "entry-1",
        status: "success",
      },
    });
    useMaintenancePreviewStore.setState({
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

    useMaintenanceEntryStore.getState().setEntries([createMaintenanceEntry(createMaintenanceCrawlerData())], "/media");
    invalidateMaintenancePreview();

    expect(useMaintenanceExecutionStore.getState().itemResults).toEqual({});
    expect(useMaintenancePreviewStore.getState().previewPending).toBe(false);
    expect(useMaintenancePreviewStore.getState().executeDialogOpen).toBe(false);
    expect(useMaintenancePreviewStore.getState().previewResults).toEqual({});
    expect(useMaintenancePreviewStore.getState().fieldSelections).toEqual({});
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

    useMaintenanceEntryStore.getState().setEntries([firstEntry, secondEntry], "/media");
    useMaintenanceEntryStore.getState().setActiveId("entry-2");
    useMaintenanceExecutionStore.setState({
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

    const entryState = useMaintenanceEntryStore.getState();
    const executionState = useMaintenanceExecutionStore.getState();
    const previewState = useMaintenancePreviewStore.getState();
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
    useMaintenanceEntryStore.getState().setEntries(
      [
        createMaintenanceEntry(createMaintenanceCrawlerData()),
        {
          ...createMaintenanceEntry(createMaintenanceCrawlerData({ number: "ABC-124" })),
          fileId: "entry-2",
        },
      ],
      "/media",
    );
    useMaintenanceExecutionStore.setState({
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
    useMaintenancePreviewStore.setState({
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

    expect(useMaintenanceEntryStore.getState().selectedIds).toEqual(["entry-1"]);
    expect(useMaintenancePreviewStore.getState().previewResults).toEqual({});
    expect(useMaintenanceExecutionStore.getState().itemResults).toEqual({});
  });

  it("preserves preview state when selection changes under diff presets", () => {
    useMaintenanceEntryStore.getState().setEntries(
      [
        createMaintenanceEntry(createMaintenanceCrawlerData()),
        {
          ...createMaintenanceEntry(createMaintenanceCrawlerData({ number: "ABC-124" })),
          fileId: "entry-2",
        },
      ],
      "/media",
    );
    useMaintenanceEntryStore.getState().setPresetId("refresh_data");
    useMaintenanceExecutionStore.setState({
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
    useMaintenancePreviewStore.setState({
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

    expect(useMaintenanceEntryStore.getState().selectedIds).toEqual(["entry-1"]);
    expect(useMaintenancePreviewStore.getState().previewResults).toEqual({
      "entry-1": {
        fileId: "entry-1",
        status: "ready",
      },
    });
    expect(useMaintenanceExecutionStore.getState().itemResults).toEqual({
      "entry-1": {
        fileId: "entry-1",
        status: "success",
      },
    });
  });

  it("invalidates preview state when preset changes", () => {
    useMaintenanceEntryStore.getState().setEntries([createMaintenanceEntry(createMaintenanceCrawlerData())], "/media");
    useMaintenanceEntryStore.getState().setPresetId("refresh_data");
    useMaintenancePreviewStore.setState({
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

    expect(useMaintenanceEntryStore.getState().presetId).toBe("organize_files");
    expect(useMaintenancePreviewStore.getState().previewResults).toEqual({});
  });

  it("resets preview flow back to idle state when previewing is canceled", () => {
    useMaintenanceEntryStore.getState().setEntries([createMaintenanceEntry(createMaintenanceCrawlerData())], "/media");
    useMaintenanceExecutionStore.setState({
      executionStatus: "previewing",
      progressValue: 37,
      progressCurrent: 1,
      progressTotal: 3,
      itemResults: {},
    });
    useMaintenancePreviewStore.setState({
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

    expect(useMaintenanceExecutionStore.getState()).toMatchObject({
      executionStatus: "idle",
      progressValue: 0,
      progressCurrent: 0,
      progressTotal: 0,
      itemResults: {},
    });
    expect(useMaintenancePreviewStore.getState().previewResults).toEqual({});
    expect(useMaintenancePreviewStore.getState().fieldSelections).toEqual({});
  });
});
