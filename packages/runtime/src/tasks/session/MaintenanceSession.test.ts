import { describe, expect, it } from "vitest";
import { MaintenanceSession, StaleMaintenanceGenerationError } from "./MaintenanceSession";

const createSession = () =>
  new MaintenanceSession({
    id: "maintenance-1",
    rootId: "root-1",
    presetId: "organize_files",
    refs: [{ relativePath: "one.mp4" }, { relativePath: "two.mp4" }],
    generation: 1,
    now: new Date("2026-01-01T00:00:00.000Z"),
  });

describe("MaintenanceSession", () => {
  it("owns transitions, monotonic progress, immutable snapshots, and generation fencing", () => {
    const session = createSession();
    session.startRunning(1);
    session.addPreview(1, {
      rootId: "root-1",
      relativePath: "one.mp4",
      status: "ready",
      error: null,
      fieldDiffs: [],
      unchangedFieldDiffs: [],
      pathDiff: null,
      proposedCrawlerData: null,
    });
    const first = session.snapshot();
    expect(first).toMatchObject({ status: "running", completedEntries: 1, successCount: 1 });
    const [firstRef] = first.refs;
    const [firstPreview] = first.previews;
    if (!firstRef || !firstPreview) throw new Error("Expected preview snapshot");
    firstRef.relativePath = "mutated.mp4";
    firstPreview.status = "failed";
    expect(session.snapshot().refs[0]).toEqual({ relativePath: "one.mp4" });
    expect(session.snapshot().successCount).toBe(1);

    session.finish(1, "completed", null);
    const previewId = session.snapshot().previews[0]?.id;
    if (!previewId) throw new Error("Expected preview ID");
    const apply = session.beginApply([{ previewId }]);
    expect(apply.generation).toBe(2);
    expect(session.progress()).toEqual({ totalEntries: 1, completedEntries: 0, successCount: 0, failedCount: 0 });
    expect(() => session.assertGeneration(1)).toThrow(StaleMaintenanceGenerationError);

    session.startRunning(2);
    const [item] = session.pendingBatchItems();
    if (!item) throw new Error("Expected apply item");
    session.markApplyProcessing(2, item);
    session.commitItem(2, item, { status: "success" });
    expect(session.progress()).toEqual({ totalEntries: 1, completedEntries: 1, successCount: 1, failedCount: 0 });
    session.finish(2, "completed", null);
    expect(() => session.startRunning(2)).toThrow(StaleMaintenanceGenerationError);
  });
});
