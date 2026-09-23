import { describe, expect, it } from "vitest";
import { InactiveMaintenanceSessionError, MaintenanceSession } from "./MaintenanceSession";

const createSession = () =>
  new MaintenanceSession({
    id: "maintenance-1",
    rootId: "root-1",
    presetId: "local_organize",
    refs: [
      { rootId: "root-1", relativePath: "one.mp4" },
      { rootId: "root-1", relativePath: "two.mp4" },
    ],
    now: new Date("2026-01-01T00:00:00.000Z"),
  });

const initialEntries = [
  {
    fileId: "one.mp4",
    ref: { rootId: "root-1", relativePath: "one.mp4" },
    fileInfo: {
      filePath: "/media/one.mp4",
      fileName: "one.mp4",
      extension: ".mp4",
      number: "ONE",
      isSubtitled: false,
    },
    assets: { sceneImages: [], actorPhotos: [] },
    currentDir: "/media",
  },
];

describe("MaintenanceSession", () => {
  it("owns transitions, monotonic progress, and immutable snapshots", () => {
    const session = createSession();
    session.startRunning();
    session.initializeEntries(initialEntries);
    expect(session.snapshot().previews).toEqual([
      expect.objectContaining({ relativePath: "one.mp4", status: "pending" }),
    ]);
    expect(session.progress()).toMatchObject({ totalEntries: 2, completedEntries: 0, successCount: 0 });

    const processing = session.markPreviewProcessing("root-1", "one.mp4");
    expect(processing?.status).toBe("processing");
    expect(session.snapshot().previews[0]?.status).toBe("processing");

    session.commitPreview({
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
    expect(session.snapshot().refs[0]).toEqual({ rootId: "root-1", relativePath: "one.mp4" });
    expect(session.snapshot().successCount).toBe(1);

    session.finish("completed", null);
    const previewId = session.snapshot().previews[0]?.id;
    if (!previewId) throw new Error("Expected preview ID");
    session.beginApply([{ previewId }]);
    expect(session.progress()).toEqual({ totalEntries: 1, completedEntries: 0, successCount: 0, failedCount: 0 });
    session.startRunning();
    const [item] = session.pendingBatchItems();
    if (!item) throw new Error("Expected apply item");
    session.markApplyProcessing(item);
    session.commitItem(item, { status: "success" });
    expect(session.progress()).toEqual({ totalEntries: 1, completedEntries: 1, successCount: 1, failedCount: 0 });
    session.finish("completed", null);
    expect(() => session.startRunning()).toThrow(InactiveMaintenanceSessionError);
  });
});
