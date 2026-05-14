import { maintenancePreviewDtoToPreviewItem } from "@mdcz/shared/dtoAdapters";
import type { WebTaskUpdateDto } from "@mdcz/shared/serverDtos";
import { useMaintenanceExecutionStore } from "@mdcz/shared/stores/maintenanceExecutionStore";
import { useMaintenancePreviewStore } from "@mdcz/shared/stores/maintenancePreviewStore";
import { useScrapeStore } from "@mdcz/shared/stores/scrapeStore";
import { useUIStore } from "@mdcz/shared/stores/uiStore";
import { createTaskHydrationState, useWorkbenchTaskStore } from "@mdcz/shared/stores/workbenchTaskStore";
import { buildScrapeResultGroups } from "@mdcz/shared/viewModels/scrapeResultGrouping";
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyTaskRealtimeEvent,
  applyWebTaskUpdate,
  hydrateWorkbenchScrapeResults,
  selectWorkbenchScrapeResults,
} from "../taskHydration";
import { __workbenchTestHooks } from "./workbench";

describe("web workbench route contracts", () => {
  beforeEach(() => {
    useScrapeStore.getState().reset();
    useMaintenanceExecutionStore.getState().reset();
    useMaintenancePreviewStore.getState().reset();
    useWorkbenchTaskStore.getState().reset();
    useUIStore.getState().setSelectedResultId(null);
  });

  it("keeps uncensored ambiguous flags when projecting scrape result DTOs", () => {
    const result = __workbenchTestHooks.dtoToScrapeResult({
      id: "result-1",
      taskId: "task-1",
      rootId: "root-1",
      rootDisplayName: "Media",
      relativePath: "ABP-999-U.mp4",
      fileName: "ABP-999-U.mp4",
      status: "success",
      error: null,
      crawlerData: null,
      nfoRelativePath: "ABP-999-U.nfo",
      outputRelativePath: "JAV_output/ABP-999/ABP-999-U.mp4",
      manualUrl: null,
      uncensoredAmbiguous: true,
      createdAt: "2026-05-03T00:00:00.000Z",
      updatedAt: "2026-05-03T00:00:00.000Z",
    });

    expect(result.uncensoredAmbiguous).toBe(true);
    expect(result.nfoPath).toBe("ABP-999-U.nfo");
    expect(result.fileId).toBe("root-1:ABP-999-U.mp4");
    expect(result.fileInfo.filePath).toBe("ABP-999-U.mp4");
  });

  it("builds mounted refs for failed scrape retry targets", () => {
    const failed = __workbenchTestHooks.dtoToScrapeResult({
      id: "result-1",
      taskId: "task-1",
      rootId: "root-1",
      rootDisplayName: "Media",
      relativePath: "nested/ABC-001.mp4",
      fileName: "ABC-001.mp4",
      status: "failed",
      error: "boom",
      crawlerData: null,
      nfoRelativePath: null,
      outputRelativePath: null,
      manualUrl: null,
      uncensoredAmbiguous: false,
      createdAt: "2026-05-03T00:00:00.000Z",
      updatedAt: "2026-05-03T00:00:00.000Z",
    });

    expect(__workbenchTestHooks.scrapeResultsToWebRetryTargets([failed])).toEqual([
      {
        filePath: "nested/ABC-001.mp4",
        ref: { rootId: "root-1", relativePath: "nested/ABC-001.mp4" },
      },
    ]);
  });

  it("uses desktop-baseline confirmation copy for web scrape stop and retry", () => {
    expect(__workbenchTestHooks.STOP_SCRAPE_CONFIRM_MESSAGE).toBe("确定要停止刮削吗？");
    expect(__workbenchTestHooks.getRetryFailedConfirmMessage(3)).toBe("确定要批量重试 3 个失败项目吗？");
  });

  it("hydrates only the active scrape task results for workbench restoration", () => {
    const response = {
      results: [
        {
          id: "result-2",
          taskId: "task-2",
          rootId: "root-1",
          rootDisplayName: "Media",
          relativePath: "BBB-002.mp4",
          fileName: "BBB-002.mp4",
          status: "success" as const,
          error: null,
          crawlerData: null,
          nfoRelativePath: "BBB-002.nfo",
          outputRelativePath: "JAV_output/BBB-002/BBB-002.mp4",
          manualUrl: null,
          uncensoredAmbiguous: false,
          createdAt: "2026-05-04T00:00:00.000Z",
          updatedAt: "2026-05-04T00:00:00.000Z",
        },
        {
          id: "result-1",
          taskId: "task-1",
          rootId: "root-1",
          rootDisplayName: "Media",
          relativePath: "AAA-001.mp4",
          fileName: "AAA-001.mp4",
          status: "success" as const,
          error: null,
          crawlerData: null,
          nfoRelativePath: "AAA-001.nfo",
          outputRelativePath: "JAV_output/AAA-001/AAA-001.mp4",
          manualUrl: null,
          uncensoredAmbiguous: false,
          createdAt: "2026-05-03T00:00:00.000Z",
          updatedAt: "2026-05-03T00:00:00.000Z",
        },
      ],
    };

    expect(selectWorkbenchScrapeResults(response, "")).toEqual({
      taskId: "",
      results: [],
    });

    const state = hydrateWorkbenchScrapeResults(response, {
      ...createTaskHydrationState(),
      activeScrapeTaskId: "task-1",
    });
    expect(state.activeScrapeTaskId).toBe("task-1");
    expect(useScrapeStore.getState().results).toHaveLength(1);
    expect(useScrapeStore.getState().results[0]?.fileId).toBe("root-1:AAA-001.mp4");
    expect(useUIStore.getState().selectedResultId).toBeNull();
  });

  it("keeps an active scrape task selected even before it has results", () => {
    expect(selectWorkbenchScrapeResults({ results: [] }, "task-running")).toEqual({
      taskId: "task-running",
      results: [],
    });
  });

  it("does not label pending scrape rows as successful", () => {
    const groups = buildScrapeResultGroups([
      {
        fileId: "root-1:ABC-001.mp4",
        fileInfo: {
          extension: "mp4",
          fileName: "ABC-001.mp4",
          filePath: "ABC-001.mp4",
          isSubtitled: false,
          number: "ABC-001",
        },
        status: "pending",
      },
    ]);

    expect(groups[0]?.status).toBe("processing");
  });

  it("restores running scrape progress from task snapshots", () => {
    const state = applyWebTaskUpdate(
      {
        kind: "snapshot",
        tasks: [
          {
            id: "task-running",
            kind: "scrape",
            rootId: "root-1",
            rootDisplayName: "Media",
            status: "running",
            createdAt: "2026-05-06T00:00:00.000Z",
            updatedAt: "2026-05-06T00:00:00.000Z",
            startedAt: "2026-05-06T00:00:01.000Z",
            completedAt: null,
            videoCount: 2,
            directoryCount: 0,
            error: null,
            videos: ["A.mp4", "B.mp4", "C.mp4", "D.mp4"],
          },
        ],
      },
      createTaskHydrationState(),
    );

    expect(state.activeScrapeTaskId).toBe("task-running");
    expect(useScrapeStore.getState()).toMatchObject({
      isScraping: true,
      scrapeStatus: "running",
      current: 2,
      total: 4,
      progress: 50,
    });
  });

  it("does not reset restored scrape progress from a running task snapshot with no completed count", () => {
    useScrapeStore.getState().setScraping(true);
    useScrapeStore.getState().setScrapeStatus("running");
    useScrapeStore.getState().updateProgress(35, 100);

    const state = applyWebTaskUpdate(
      {
        kind: "snapshot",
        tasks: [
          {
            id: "task-running",
            kind: "scrape",
            rootId: "root-1",
            rootDisplayName: "Media",
            status: "running",
            createdAt: "2026-05-06T00:00:00.000Z",
            updatedAt: "2026-05-06T00:00:00.000Z",
            startedAt: "2026-05-06T00:00:01.000Z",
            completedAt: null,
            videoCount: 0,
            directoryCount: 0,
            error: null,
            videos: ["A.mp4", "B.mp4"],
          },
        ],
      },
      { ...createTaskHydrationState(), activeScrapeTaskId: "task-running" },
    );

    expect(state.activeScrapeTaskId).toBe("task-running");
    expect(useScrapeStore.getState()).toMatchObject({
      isScraping: true,
      scrapeStatus: "running",
      current: 35,
      total: 100,
      progress: 35,
    });
  });

  it("restores a completed active scrape task from snapshots after route changes", () => {
    const state = applyWebTaskUpdate(
      {
        kind: "snapshot",
        tasks: [
          {
            id: "task-completed",
            kind: "scrape",
            rootId: "root-1",
            rootDisplayName: "Media",
            status: "completed",
            createdAt: "2026-05-06T00:00:00.000Z",
            updatedAt: "2026-05-06T00:00:00.000Z",
            startedAt: "2026-05-06T00:00:01.000Z",
            completedAt: "2026-05-06T00:00:10.000Z",
            videoCount: 1,
            directoryCount: 0,
            error: null,
            videos: ["A.mp4"],
          },
        ],
      },
      { ...createTaskHydrationState(), activeScrapeTaskId: "task-completed" },
    );

    expect(state.activeScrapeTaskId).toBe("task-completed");
    expect(useScrapeStore.getState()).toMatchObject({
      isScraping: false,
      scrapeStatus: "idle",
      current: 1,
      total: 1,
      progress: 100,
    });
  });

  it("accepts completed task events carrying ambiguous uncensored items", () => {
    const payload: WebTaskUpdateDto = {
      kind: "event",
      event: {
        id: "event-1",
        taskId: "task-1",
        type: "completed",
        message: "done",
        createdAt: "2026-05-03T00:00:00.000Z",
      },
      ambiguousUncensoredItems: [
        {
          id: "result-1",
          ref: { rootId: "root-1", relativePath: "ABP-999-U.mp4" },
          fileId: "root-1:ABP-999-U.mp4",
          fileName: "ABP-999-U.mp4",
          number: "ABP-999",
          title: "Runtime UC Title",
          nfoRelativePath: "ABP-999-U.nfo",
        },
      ],
    };

    expect(payload.ambiguousUncensoredItems?.[0]?.ref).toEqual({
      rootId: "root-1",
      relativePath: "ABP-999-U.mp4",
    });

    const state = applyWebTaskUpdate(payload, createTaskHydrationState());
    expect(state).toMatchObject({
      uncensoredTaskId: "task-1",
      shouldOpenUncensoredDialog: true,
    });
    expect(state.ambiguousUncensoredItems).toHaveLength(1);
  });

  it("maps maintenance preview DTOs into desktop-compatible preview items", () => {
    const item = maintenancePreviewDtoToPreviewItem({
      id: "preview-1",
      taskId: "task-1",
      presetId: "refresh_data",
      rootId: "root-1",
      rootDisplayName: "Media",
      relativePath: "ABC-001.mp4",
      fileName: "ABC-001.mp4",
      status: "ready",
      error: null,
      fieldDiffs: [
        {
          kind: "value",
          field: "title",
          label: "标题",
          oldValue: "Old",
          newValue: "New",
          changed: true,
        },
      ],
      unchangedFieldDiffs: [],
      pathDiff: {
        changed: false,
        currentDir: "/media",
        currentVideoPath: "/media/ABC-001.mp4",
        fileId: "root-1:ABC-001.mp4",
        targetDir: "/media",
        targetVideoPath: "/media/ABC-001.mp4",
      },
      proposedCrawlerData: null,
      createdAt: "2026-05-04T00:00:00.000Z",
      updatedAt: "2026-05-04T00:00:00.000Z",
    });

    expect(item).toMatchObject({
      fileId: "root-1:ABC-001.mp4",
      previewId: "preview-1",
      taskId: "task-1",
      status: "ready",
      fieldDiffs: [{ field: "title", changed: true }],
    });
  });

  it("accepts realtime scrape result events", () => {
    const state = applyTaskRealtimeEvent(
      {
        id: "realtime-1",
        taskId: "task-1",
        createdAt: "2026-05-06T00:00:00.000Z",
        kind: "scrape-result",
        result: {
          id: "result-1",
          taskId: "task-1",
          rootId: "root-1",
          rootDisplayName: "Media",
          relativePath: "ABC-001.mp4",
          fileName: "ABC-001.mp4",
          status: "processing",
          error: null,
          crawlerData: null,
          nfoRelativePath: null,
          outputRelativePath: null,
          manualUrl: null,
          uncensoredAmbiguous: false,
          createdAt: "2026-05-06T00:00:00.000Z",
          updatedAt: "2026-05-06T00:00:00.000Z",
        },
      },
      createTaskHydrationState(),
    );

    expect(state.activeScrapeTaskId).toBe("task-1");
  });

  it("routes realtime progress by task kind", () => {
    applyTaskRealtimeEvent(
      {
        id: "progress-1",
        taskId: "scrape-task",
        createdAt: "2026-05-06T00:00:00.000Z",
        kind: "task-progress",
        taskKind: "scrape",
        value: 35,
        current: 2,
        total: 4,
      },
      createTaskHydrationState(),
    );

    expect(useScrapeStore.getState()).toMatchObject({ current: 35, total: 100, progress: 35 });
    expect(useMaintenanceExecutionStore.getState()).toMatchObject({ progressCurrent: 0, progressTotal: 0 });

    applyTaskRealtimeEvent(
      {
        id: "progress-2",
        taskId: "maintenance-task",
        createdAt: "2026-05-06T00:00:00.000Z",
        kind: "task-progress",
        taskKind: "maintenance",
        value: 44,
        current: 1,
        total: 5,
      },
      createTaskHydrationState(),
    );

    expect(useScrapeStore.getState()).toMatchObject({ current: 35, total: 100 });
    expect(useMaintenanceExecutionStore.getState()).toMatchObject({
      progressCurrent: 1,
      progressTotal: 5,
      progressValue: 44,
    });
  });

  it("applies realtime maintenance preview and apply items by stable file identity", () => {
    applyTaskRealtimeEvent(
      {
        id: "preview-event-1",
        taskId: "maintenance-task",
        createdAt: "2026-05-06T00:00:00.000Z",
        kind: "maintenance-preview-item",
        item: {
          id: "preview-1",
          taskId: "maintenance-task",
          presetId: "refresh_data",
          rootId: "root-1",
          rootDisplayName: "Media",
          relativePath: "ABC-001.mp4",
          fileName: "ABC-001.mp4",
          status: "ready",
          error: null,
          fieldDiffs: [],
          unchangedFieldDiffs: [],
          pathDiff: null,
          proposedCrawlerData: null,
          createdAt: "2026-05-06T00:00:00.000Z",
          updatedAt: "2026-05-06T00:00:00.000Z",
        },
      },
      createTaskHydrationState(),
    );

    expect(useMaintenancePreviewStore.getState().previewResults["root-1:ABC-001.mp4"]).toMatchObject({
      fileId: "root-1:ABC-001.mp4",
      previewId: "preview-1",
      status: "ready",
    });

    applyTaskRealtimeEvent(
      {
        id: "apply-event-1",
        taskId: "maintenance-task",
        createdAt: "2026-05-06T00:00:00.000Z",
        kind: "maintenance-apply-item",
        item: {
          id: "apply-1",
          taskId: "maintenance-task",
          previewId: "preview-1",
          rootId: "root-1",
          relativePath: "ABC-001.mp4",
          presetId: "refresh_data",
          status: "success",
          error: null,
          appliedAt: "2026-05-06T00:00:00.000Z",
        },
      },
      createTaskHydrationState(),
    );

    expect(useMaintenanceExecutionStore.getState().itemResults["root-1:ABC-001.mp4"]).toMatchObject({
      fileId: "root-1:ABC-001.mp4",
      status: "success",
    });
  });
});
