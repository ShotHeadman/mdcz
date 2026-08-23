import { fileURLToPath } from "node:url";
import { createMediaRoot, resolveRootRelativePath } from "@mdcz/media-store";
import type { LocalScanEntry } from "@mdcz/shared/types";
import { describe, expect, it, vi } from "vitest";
import { MaintenanceTaskCoordinator } from "./coordinator";
import { InMemoryMaintenanceTaskStore } from "./InMemoryMaintenanceTaskStore";
import type { MaintenanceRuntime } from "./MaintenanceRuntime";

const root = createMediaRoot({ id: "root-1", displayName: "Media", hostPath: process.cwd() });

const createEntry = (relativePath: string): LocalScanEntry => ({
  fileId: relativePath,
  rootRef: { rootId: root.id, relativePath },
  fileInfo: {
    filePath: resolveRootRelativePath(root, relativePath),
    fileName: relativePath,
    extension: ".mp4",
    number: relativePath.replace(/\.mp4$/u, ""),
    isSubtitled: false,
  },
  assets: { sceneImages: [], actorPhotos: [] },
  currentDir: root.hostPath,
});

const toRuntimePreview = (entry: LocalScanEntry) => ({
  entry,
  rootId: root.id,
  relativePath: entry.rootRef?.relativePath ?? entry.fileInfo.fileName,
  status: "ready" as const,
  error: null,
  fieldDiffs: [],
  unchangedFieldDiffs: [],
  pathDiff: null,
  proposedCrawlerData: {
    title: entry.fileId,
    number: entry.fileId,
    actors: [],
    genres: [],
    scene_images: [],
  },
});

const createCoordinator = (runtimeOverrides: Partial<MaintenanceRuntime> = {}) => {
  const store = new InMemoryMaintenanceTaskStore();
  const runtime = {
    scan: vi.fn(async () => []),
    scanRefs: vi.fn(async ({ refs }: { refs: Array<{ relativePath: string }> }) =>
      refs.map((ref) => createEntry(ref.relativePath)),
    ),
    previewEntries: vi.fn(async ({ entries }: { entries: LocalScanEntry[] }) => entries.map(toRuntimePreview)),
    applyEntry: vi.fn(),
    ...runtimeOverrides,
  } as unknown as MaintenanceRuntime;
  const events: unknown[] = [];
  const library = {
    resolveSource: vi.fn(async () => null),
    preflightRefresh: vi.fn(async () => undefined),
    commitRefresh: vi.fn(async () => ({ libraryItemId: "test-item" })),
  };
  const coordinator = new MaintenanceTaskCoordinator({
    store,
    roots: { getActiveRoot: async () => root },
    runtime,
    library,
    events: {
      publish: (event) => {
        events.push(event);
      },
    },
    concurrency: 1,
  });
  return { coordinator, events, library, runtime, store };
};

describe("MaintenanceTaskCoordinator", () => {
  it("preflights before file work and does not report success when the final library transaction fails", async () => {
    const order: string[] = [];
    const outputPath = fileURLToPath(import.meta.url);
    const fixture = createCoordinator({
      applyEntry: vi.fn(async ({ entry }) => {
        order.push("apply");
        return {
          status: "success" as const,
          entry: { ...entry, fileInfo: { ...entry.fileInfo, filePath: outputPath } },
          outputRelativePath: "one.mp4",
        };
      }),
    });
    fixture.library.preflightRefresh.mockImplementation(async () => {
      order.push("preflight");
    });
    fixture.library.commitRefresh.mockImplementation(async () => {
      order.push("commit");
      throw new Error("database unavailable");
    });
    const preview = await fixture.coordinator.startPreview({
      rootId: root.id,
      presetId: "organize_files",
      refs: [{ relativePath: "one.mp4" }],
    });
    const previewBatch = await preview.completion;
    const apply = await fixture.coordinator.beginApply({
      taskId: preview.task.id,
      selections: [{ previewId: previewBatch.items[0]?.id ?? "" }],
    });
    const batch = await apply.completion;

    expect(order).toEqual(["preflight", "apply", "commit"]);
    expect(batch.applied).toEqual([
      expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("文件操作已完成，但媒体库提交失败"),
      }),
    ]);
    await fixture.coordinator.close();
  });

  it("persists the in-flight preview once, pauses admission, and resumes only pending refs", async () => {
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const fixture = createCoordinator();
    vi.mocked(fixture.runtime.previewEntries).mockImplementation(async ({ entries }) => {
      firstStarted();
      if (entries[0]?.fileId === "one.mp4") await blocked;
      return entries.map(toRuntimePreview);
    });
    const handle = await fixture.coordinator.startPreview({
      rootId: root.id,
      presetId: "refresh_data",
      refs: ["one.mp4", "two.mp4", "three.mp4"].map((relativePath) => ({ relativePath })),
    });
    await started;
    await expect(fixture.coordinator.pause(handle.task.id)).resolves.toMatchObject({ status: "paused" });
    releaseFirst();
    await vi.waitFor(async () => expect(await fixture.store.listPreviews(handle.task.id)).toHaveLength(1));
    expect(vi.mocked(fixture.runtime.previewEntries)).toHaveBeenCalledTimes(1);

    await expect(fixture.coordinator.resume(handle.task.id)).resolves.toMatchObject({ status: "queued" });
    const batch = await handle.completion;
    expect(batch.task.status).toBe("completed");
    expect(batch.items.map((item) => item.relativePath)).toEqual(["one.mp4", "three.mp4", "two.mp4"]);
    expect(vi.mocked(fixture.runtime.previewEntries)).toHaveBeenCalledTimes(3);
    expect(new Set(batch.items.map((item) => item.id)).size).toBe(3);
    await fixture.coordinator.close();
  });

  it("stops active apply work and records every selected item exactly once", async () => {
    let applyStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      applyStarted = resolve;
    });
    const fixture = createCoordinator();
    vi.mocked(fixture.runtime.applyEntry).mockImplementation(
      async ({ signal }) =>
        await new Promise((_resolve, reject) => {
          applyStarted();
          signal?.addEventListener(
            "abort",
            () => {
              const error = new Error("Operation aborted");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        }),
    );
    const preview = await fixture.coordinator.startPreview({
      rootId: root.id,
      presetId: "organize_files",
      refs: ["one.mp4", "two.mp4", "three.mp4"].map((relativePath) => ({ relativePath })),
    });
    const previewBatch = await preview.completion;
    const apply = await fixture.coordinator.beginApply({
      taskId: preview.task.id,
      selections: previewBatch.items.map((item) => ({ previewId: item.id })),
    });
    await started;
    await fixture.coordinator.stop(preview.task.id);
    const batch = await apply.completion;
    expect(batch.task).toMatchObject({ status: "failed", error: "维护已停止" });
    expect(batch.applied).toHaveLength(3);
    expect(new Set(batch.applied.map((item) => item.previewId)).size).toBe(3);
    expect(batch.applied.every((item) => item.status === "skipped")).toBe(true);
    expect(batch.items).toEqual([]);
    expect(vi.mocked(fixture.runtime.applyEntry)).toHaveBeenCalledTimes(1);
    await fixture.coordinator.close();
  });

  it("pauses between apply items and resumes pending work without replaying a terminal item", async () => {
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const fixture = createCoordinator();
    vi.mocked(fixture.runtime.applyEntry).mockImplementation(async ({ entry }) => {
      if (entry.fileId === "one.mp4") {
        firstStarted();
        await blocked;
      }
      return { status: "failed", error: entry.fileId };
    });
    const previewHandle = await fixture.coordinator.startPreview({
      rootId: root.id,
      presetId: "organize_files",
      refs: [{ relativePath: "one.mp4" }, { relativePath: "two.mp4" }],
    });
    const previewBatch = await previewHandle.completion;
    const applyHandle = await fixture.coordinator.beginApply({
      taskId: previewHandle.task.id,
      selections: previewBatch.items.map((item) => ({ previewId: item.id })),
    });
    await started;
    await fixture.coordinator.pause(previewHandle.task.id);
    releaseFirst();
    await vi.waitFor(async () => expect(await fixture.store.listApplyLogs(previewHandle.task.id)).toHaveLength(1));
    expect(await fixture.store.listPendingApplyItems(previewHandle.task.id)).toHaveLength(1);
    await fixture.coordinator.resume(previewHandle.task.id);
    const applied = await applyHandle.completion;
    expect(applied.applied).toHaveLength(2);
    expect(vi.mocked(fixture.runtime.applyEntry).mock.calls.map(([input]) => input.entry.fileId)).toEqual([
      "one.mp4",
      "two.mp4",
    ]);
    await fixture.coordinator.close();
  });
});
