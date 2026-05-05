import type { WebTaskUpdateDto } from "@mdcz/shared";
import { applyWebTaskUpdate, createTaskHydrationState, maintenancePreviewDtoToPreviewItem } from "@mdcz/shared";
import { describe, expect, it } from "vitest";
import { __workbenchTestHooks } from "./workbench";

describe("web workbench route contracts", () => {
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

    expect(__workbenchTestHooks.scrapeResultsToRetryTargets([failed])).toEqual([
      {
        filePath: "nested/ABC-001.mp4",
        ref: { rootId: "root-1", relativePath: "nested/ABC-001.mp4" },
      },
    ]);
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
});
