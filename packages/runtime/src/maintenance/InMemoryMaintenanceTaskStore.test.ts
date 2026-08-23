import type { MaintenanceTaskPreview } from "@mdcz/shared/maintenanceTasks";
import { describe, expect, it } from "vitest";
import { InMemoryMaintenanceTaskStore } from "./InMemoryMaintenanceTaskStore";

const preview = (taskId: string, id: string): MaintenanceTaskPreview => {
  const now = new Date();
  return {
    id,
    taskId,
    rootId: "root-1",
    relativePath: `${id}.mp4`,
    presetId: "refresh_data",
    status: "ready",
    error: null,
    fieldDiffs: [],
    unchangedFieldDiffs: [],
    pathDiff: null,
    proposedCrawlerData: null,
    createdAt: now,
    updatedAt: now,
  };
};

describe("InMemoryMaintenanceTaskStore", () => {
  it("keeps one process-local session and starts empty after process recreation", async () => {
    const store = new InMemoryMaintenanceTaskStore();
    const task = await store.createPreviewExecution({
      rootId: "root-1",
      presetId: "refresh_data",
      refs: [{ relativePath: "one.mp4" }],
    });
    await expect(store.createPreviewExecution({ rootId: "root-1", presetId: "refresh_data" })).rejects.toThrow(
      "已有活动的维护会话",
    );
    expect((await store.getActiveSession())?.task.id).toBe(task.id);
    expect(await new InMemoryMaintenanceTaskStore().getActiveSession()).toBeNull();
  });

  it("removes terminal items and drafts while retaining only the latest batch result", async () => {
    const store = new InMemoryMaintenanceTaskStore();
    const task = await store.createPreviewExecution({ rootId: "root-1", presetId: "refresh_data" });
    const claim = await store.claimNext();
    const owner = { taskId: task.id, executionVersion: claim?.task.executionVersion ?? -1 };
    await store.commitPreviewItem(owner, {
      preview: preview(task.id, "preview-1"),
      progress: { totalEntries: 1, completedEntries: 1, successCount: 1, failedCount: 0 },
    });
    await store.transition({
      owner,
      expectedStatus: "running",
      patch: { status: "completed", completedAt: new Date() },
    });
    await store.updateDraft({
      taskId: task.id,
      previewId: "preview-1",
      fieldSelections: { title: "old" },
      imageSelections: { poster: "old.jpg" },
    });
    await store.queueApply({
      taskId: task.id,
      expectedExecutionVersion: owner.executionVersion,
      selections: [{ previewId: "preview-1" }],
      patch: {
        status: "queued",
        progress: { totalEntries: 1, completedEntries: 0, successCount: 0, failedCount: 0 },
      },
    });
    expect(await store.getActiveSession()).toMatchObject({
      applyItems: [{ previewId: "preview-1", status: "pending" }],
    });
    const applyClaim = await store.claimNext();
    const applyOwner = { taskId: task.id, executionVersion: applyClaim?.task.executionVersion ?? -1 };
    const [item] = await store.listPendingApplyItems(task.id);
    const log = await store.commitApplyItem(applyOwner, item?.id ?? "", { status: "failed", error: "boom" });
    expect(log?.batchId).toBeTruthy();
    expect(await store.listPreviews(task.id)).toEqual([]);
    expect(await store.getActiveSession()).toMatchObject({
      draft: { fieldSelections: {}, imageSelections: {} },
      recentBatch: { batchId: log?.batchId, items: [{ result: { status: "failed", error: "boom" } }] },
    });
  });

  it("keeps unselected previews editable and replaces the previous result when the next batch starts", async () => {
    const store = new InMemoryMaintenanceTaskStore();
    const task = await store.createPreviewExecution({ rootId: "root-1", presetId: "refresh_data" });
    const previewClaim = await store.claimNext();
    const previewOwner = { taskId: task.id, executionVersion: previewClaim?.task.executionVersion ?? -1 };
    await store.commitPreviewItem(previewOwner, {
      preview: preview(task.id, "preview-1"),
      progress: { totalEntries: 2, completedEntries: 1, successCount: 1, failedCount: 0 },
    });
    await store.commitPreviewItem(previewOwner, {
      preview: preview(task.id, "preview-2"),
      progress: { totalEntries: 2, completedEntries: 2, successCount: 2, failedCount: 0 },
    });
    await store.transition({ owner: previewOwner, expectedStatus: "running", patch: { status: "completed" } });
    await store.updateDraft({ taskId: task.id, previewId: "preview-2", fieldSelections: { title: "old" } });

    const runBatch = async (previewId: string, status: "failed" | "skipped") => {
      const current = await store.readTask(task.id);
      await store.queueApply({
        taskId: task.id,
        expectedExecutionVersion: current.executionVersion,
        selections: [{ previewId }],
        patch: {
          status: "queued",
          progress: { totalEntries: 1, completedEntries: 0, successCount: 0, failedCount: 0 },
        },
      });
      const claim = await store.claimNext();
      const owner = { taskId: task.id, executionVersion: claim?.task.executionVersion ?? -1 };
      const [item] = await store.listPendingApplyItems(task.id);
      await store.commitApplyItem(owner, item?.id ?? "", { status, error: status });
      await store.transition({ owner, expectedStatus: "running", patch: { status: "completed" } });
      return (await store.getActiveSession())?.recentBatch?.batchId;
    };

    const firstBatchId = await runBatch("preview-1", "failed");
    expect((await store.listPreviews(task.id)).map((item) => item.id)).toEqual(["preview-2"]);
    expect((await store.getActiveSession())?.draft.fieldSelections).toEqual({ "preview-2": { title: "old" } });
    const secondBatchId = await runBatch("preview-2", "skipped");
    expect(secondBatchId).not.toBe(firstBatchId);
    expect((await store.getActiveSession())?.recentBatch).toMatchObject({
      batchId: secondBatchId,
      items: [{ log: { previewId: "preview-2", status: "skipped" } }],
    });
    expect(await store.listPreviews(task.id)).toEqual([]);
  });
});
