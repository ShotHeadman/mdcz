import type { ScrapeLiveRunSnapshotDto, WebTaskUpdateDto } from "@mdcz/shared/serverDtos";
import type { ScrapeResult } from "@mdcz/shared/types";
import { buildScrapeResultGroups } from "@mdcz/shared/viewModels/scrapeResultGrouping";
import { useMaintenanceExecutionStore } from "@mdcz/views/state/maintenanceExecutionStore";
import { useMaintenancePreviewStore } from "@mdcz/views/state/maintenancePreviewStore";
import { useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { useUIStore } from "@mdcz/views/state/uiStore";
import { createTaskHydrationState, useWorkbenchTaskStore } from "@mdcz/views/state/workbenchTaskStore";
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyPendingUncensoredConfirmation,
  applyScrapeLiveRunsSnapshot,
  applyTaskRealtimeEvent,
  applyWebTaskUpdate,
  selectActiveLiveScrapeRun,
} from "../taskHydration";
import { __workbenchTestHooks } from "./workbench";

const liveRun = (
  id: string,
  status: ScrapeLiveRunSnapshotDto["task"]["status"],
  createdAt = "2026-05-06T00:00:00.000Z",
): ScrapeLiveRunSnapshotDto => ({
  task: {
    id,
    kind: "scrape",
    rootId: "root-1",
    rootDisplayName: "Media",
    status,
    createdAt,
    updatedAt: createdAt,
    startedAt: status === "queued" ? null : createdAt,
    completedAt: null,
    videoCount: 0,
    directoryCount: 0,
    error: null,
    continuity: "live",
  },
  progress: { percent: 50, completedItems: 1, totalItems: 2 },
  items: [
    {
      id: `${id}-item-1`,
      resultId: `${id}-outcome-1`,
      rootId: "root-1",
      relativePath: "nested/ABC-001.mp4",
      fileName: "ABC-001.mp4",
      status: "success",
      error: null,
      crawlerData: null,
      nfoRootId: null,
      nfoRelativePath: "nested/ABC-001.nfo",
      outputRootId: null,
      outputRelativePath: "JAV_output/ABC-001/ABC-001.mp4",
      assetRootId: "metadata-root",
      sceneImageRelativePaths: ["ABC-001/extrafanart/fanart1.jpg"],
      trailerRelativePath: "ABC-001/ABC-001-trailer.mp4",
      manualUrl: null,
      uncensoredAmbiguous: false,
      attempt: 1,
    },
    {
      id: `${id}-item-2`,
      resultId: null,
      rootId: "root-1",
      relativePath: "nested/ABC-002.mp4",
      fileName: "ABC-002.mp4",
      status: "processing",
      error: null,
      crawlerData: null,
      nfoRootId: null,
      nfoRelativePath: null,
      outputRootId: null,
      outputRelativePath: null,
      assetRootId: null,
      sceneImageRelativePaths: [],
      trailerRelativePath: null,
      manualUrl: null,
      uncensoredAmbiguous: false,
      attempt: 1,
    },
  ],
  latestStage: { stage: "Download", message: "Downloading poster", relativePath: "nested/ABC-002.mp4" },
  logs: [],
  ambiguousUncensoredItems: [],
});

describe("web workbench route contracts", () => {
  beforeEach(() => {
    useScrapeStore.getState().reset();
    useMaintenanceExecutionStore.getState().reset();
    useMaintenancePreviewStore.getState().reset();
    useWorkbenchTaskStore.getState().reset();
    useUIStore.getState().setSelectedResultId(null);
  });

  it("builds mounted refs for failed scrape retry targets", () => {
    const failed: ScrapeResult = {
      fileId: "root-1:nested/ABC-001.mp4",
      fileInfo: {
        extension: "mp4",
        fileName: "ABC-001.mp4",
        filePath: "nested/ABC-001.mp4",
        isSubtitled: false,
        number: "ABC-001",
      },
      status: "failed",
      error: "boom",
    };

    expect(__workbenchTestHooks.scrapeResultsToWebRetryTargets([failed])).toEqual([
      {
        filePath: "nested/ABC-001.mp4",
        ref: { rootId: "root-1", relativePath: "nested/ABC-001.mp4" },
      },
    ]);
  });

  it("uses the established confirmation copy for Web scrape stop and retry", () => {
    expect(__workbenchTestHooks.STOP_SCRAPE_CONFIRM_MESSAGE).toBe("确定要停止刮削吗？");
    expect(__workbenchTestHooks.getRetryFailedConfirmMessage(3)).toBe("确定要批量重试 3 个失败项目吗？");
  });

  it("uses the prior selected run before running and latest queued/paused candidates", () => {
    const retained = liveRun("retained", "paused", "2026-05-04T00:00:00.000Z");
    const running = liveRun("running", "running", "2026-05-05T00:00:00.000Z");
    const queued = liveRun("queued", "queued", "2026-05-06T00:00:00.000Z");

    expect(selectActiveLiveScrapeRun([running, queued, retained], "retained")?.task.id).toBe("retained");
    expect(selectActiveLiveScrapeRun([queued, running], "")?.task.id).toBe("running");
    expect(selectActiveLiveScrapeRun([retained, queued], "")?.task.id).toBe("queued");
  });

  it("replaces Web scrape state only from a complete liveRuns response", () => {
    useUIStore.getState().setSelectedResultId("root-1:nested/ABC-001.mp4");
    const state = applyScrapeLiveRunsSnapshot([liveRun("task-1", "paused")], createTaskHydrationState());

    expect(state.activeScrapeTaskId).toBe("task-1");
    expect(Object.keys(state.liveScrapeRunsById)).toEqual(["task-1"]);
    expect(state.latestScrapeStage).toEqual({
      taskId: "task-1",
      stage: "Download",
      message: "Downloading poster",
      relativePath: "nested/ABC-002.mp4",
    });
    expect(useScrapeStore.getState()).toMatchObject({
      isScraping: true,
      scrapeStatus: "paused",
      current: 1,
      total: 2,
      progress: 50,
      results: [
        expect.objectContaining({
          fileId: "root-1:nested/ABC-001.mp4",
          resultId: "task-1-outcome-1",
          status: "success",
          assets: {
            rootId: "metadata-root",
            sceneImages: ["ABC-001/extrafanart/fanart1.jpg"],
            trailer: "ABC-001/ABC-001-trailer.mp4",
            downloaded: [],
          },
        }),
        expect.objectContaining({ fileId: "root-1:nested/ABC-002.mp4", status: "processing" }),
      ],
    });
    expect(useUIStore.getState().selectedResultId).toBe("root-1:nested/ABC-001.mp4");
  });

  it("uses the authoritative live-run percent above the completed-item ratio", () => {
    const run = liveRun("task-progress", "running");
    run.progress.percent = 73;

    applyScrapeLiveRunsSnapshot([run], createTaskHydrationState());

    expect(useScrapeStore.getState()).toMatchObject({ current: 1, total: 2, progress: 73 });
  });

  it("clears stale workbench scrape state when the backend reports no live runs", () => {
    const previous = applyScrapeLiveRunsSnapshot([liveRun("task-1", "running")], createTaskHydrationState());
    useUIStore.getState().setSelectedResultId("root-1:nested/ABC-001.mp4");

    const state = applyScrapeLiveRunsSnapshot([], previous);

    expect(state.activeScrapeTaskId).toBe("");
    expect(state.liveScrapeRunsById).toEqual({});
    expect(useScrapeStore.getState()).toMatchObject({
      isScraping: false,
      scrapeStatus: "idle",
      current: 0,
      total: 0,
      results: [],
    });
    expect(useUIStore.getState().selectedResultId).toBeNull();
  });

  it("does not apply generic scrape tasks or realtime scrape events as workbench state", () => {
    useScrapeStore.getState().setScraping(true);
    useScrapeStore.getState().setScrapeStatus("running");
    useScrapeStore.getState().updateProgress(1, 2);
    const previous = { ...createTaskHydrationState(), activeScrapeTaskId: "live-task" };
    const taskPayload: WebTaskUpdateDto = {
      kind: "task",
      task: {
        id: "history-task",
        kind: "scrape",
        rootId: "root-1",
        rootDisplayName: "Media",
        status: "failed",
        createdAt: "2026-05-06T00:00:00.000Z",
        updatedAt: "2026-05-06T00:00:00.000Z",
        startedAt: null,
        completedAt: null,
        videoCount: 0,
        directoryCount: 0,
        error: "interrupted",
        continuity: "interrupted",
      },
    };

    expect(applyWebTaskUpdate(taskPayload, previous).activeScrapeTaskId).toBe("live-task");
    expect(
      applyTaskRealtimeEvent(
        {
          id: "stage-1",
          taskId: "history-task",
          createdAt: "2026-05-06T00:00:00.000Z",
          kind: "scrape-stage",
          stage: "Download",
          message: "ignored",
        },
        previous,
      ).activeScrapeTaskId,
    ).toBe("live-task");
    expect(useScrapeStore.getState()).toMatchObject({ current: 1, total: 2, progress: 50 });
  });

  it("opens the uncensored dialog only from the durable pending query", () => {
    const state = applyPendingUncensoredConfirmation(
      {
        items: [
          {
            id: "outcome-1",
            taskId: "task-1",
            ref: { rootId: "root-1", relativePath: "ABP-999-U.mp4" },
            fileId: "item-1",
            fileName: "ABP-999-U.mp4",
            number: "ABP-999",
            title: "Runtime UC Title",
            nfoRelativePath: "ABP-999-U.nfo",
          },
        ],
      },
      createTaskHydrationState(),
    );

    expect(state).toMatchObject({ uncensoredTaskId: "task-1", shouldOpenUncensoredDialog: true });
    expect(state.ambiguousUncensoredItems).toHaveLength(1);
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
      previewId: "preview-1",
      taskId: "maintenance-task",
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
          batchId: "batch-1",
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
      status: "success",
    });
  });
});
