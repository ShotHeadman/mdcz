import { fileURLToPath } from "node:url";
import { createMediaRoot, resolveRootRelativePath } from "@mdcz/media-store";
import type { LocalScanEntry } from "@mdcz/shared/types";
import { describe, expect, it, vi } from "vitest";
import { MaintenanceTaskCoordinator } from "./coordinator";
import type { MaintenanceRuntime } from "./MaintenanceRuntime";

type PromiseResolvers<T> = {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
};

// Node provides Promise.withResolvers; the repository's TypeScript lib target predates its declaration.
const promiseConstructor = Promise as unknown as {
  withResolvers<TResult>(): PromiseResolvers<TResult>;
};
const promiseWithResolvers = <T>(): PromiseResolvers<T> => promiseConstructor.withResolvers<T>();

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
    publishRefresh: vi.fn(async () => ({ libraryItemId: "test-item" })),
  };
  const coordinator = new MaintenanceTaskCoordinator({
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
  return { coordinator, events, library, runtime };
};

describe("MaintenanceTaskCoordinator", () => {
  it("starts with no process-local session", async () => {
    const first = createCoordinator();
    expect(await first.coordinator.getActiveSession()).toBeNull();
    expect(await createCoordinator().coordinator.getActiveSession()).toBeNull();
    await first.coordinator.close();
  });

  it("discards a completed session before starting a new one", async () => {
    const fixture = createCoordinator();
    const first = await fixture.coordinator.startPreview({
      rootId: root.id,
      presetId: "refresh_data",
      refs: [{ relativePath: "one.mp4" }],
    });
    await first.completion;

    await fixture.coordinator.discardSession(first.task.id);
    expect(await fixture.coordinator.getActiveSession()).toBeNull();

    const second = await fixture.coordinator.startPreview({
      rootId: root.id,
      presetId: "refresh_data",
      refs: [{ relativePath: "two.mp4" }],
    });
    expect(second.task.id).not.toBe(first.task.id);
    await second.completion;
    await fixture.coordinator.close();
  });

  it("refreshes the network policy before each preview and apply phase", async () => {
    let policyVersion = 0;
    const fixture = createCoordinator({
      applyNetworkPolicy: vi.fn(async () => {
        policyVersion += 1;
      }),
      previewEntries: vi.fn(async ({ entries }: { entries: LocalScanEntry[] }) => {
        expect(policyVersion).toBe(1);
        return entries.map(toRuntimePreview);
      }),
      applyEntry: vi.fn(async ({ entry }) => {
        expect(policyVersion).toBe(2);
        return { status: "failed" as const, error: entry.fileId };
      }),
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
    await apply.completion;

    expect(vi.mocked(fixture.runtime.applyNetworkPolicy)).toHaveBeenCalledTimes(2);
    await fixture.coordinator.close();
  });

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
          plan: {
            video: { sourcePath: outputPath, targetPath: outputPath, size: 1 },
            artifacts: [],
            assets: [],
            obsoletePaths: [],
          },
        };
      }),
    });
    fixture.library.preflightRefresh.mockImplementation(async () => {
      order.push("preflight");
    });
    fixture.library.publishRefresh.mockImplementation(async () => {
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

  it("commits the active preview once while paused and resumes only pending refs", async () => {
    const { promise: blocked, resolve: releaseFirst } = promiseWithResolvers<void>();
    const { promise: started, resolve: firstStarted } = promiseWithResolvers<void>();
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
    const pausing = fixture.coordinator.pause(handle.task.id);
    releaseFirst();
    await expect(pausing).resolves.toMatchObject({ status: "paused" });
    expect((await fixture.coordinator.readPreview(handle.task.id)).items).toHaveLength(1);
    expect(vi.mocked(fixture.runtime.previewEntries)).toHaveBeenCalledTimes(1);

    await expect(fixture.coordinator.resume(handle.task.id)).resolves.toMatchObject({ status: "running" });
    const batch = await handle.completion;
    expect(batch.task.status).toBe("completed");
    expect(batch.items.map((item) => item.relativePath)).toEqual(["one.mp4", "three.mp4", "two.mp4"]);
    expect(vi.mocked(fixture.runtime.previewEntries)).toHaveBeenCalledTimes(3);
    expect(new Set(batch.items.map((item) => item.id)).size).toBe(3);
    await fixture.coordinator.close();
  });

  it("stops active apply work and derives one skipped result for every selected preview", async () => {
    const { promise: started, resolve: applyStarted } = promiseWithResolvers<void>();
    const fixture = createCoordinator();
    vi.mocked(fixture.runtime.applyEntry).mockImplementation(async ({ signal }) => {
      const { promise, reject } = promiseWithResolvers<never>();
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
      return await promise;
    });
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
    const snapshot = await fixture.coordinator.getActiveSession();

    expect(batch.task).toMatchObject({ status: "failed", error: "维护已停止" });
    expect(batch.applied).toHaveLength(3);
    expect(new Set(batch.applied.map((item) => item.previewId)).size).toBe(3);
    expect(batch.applied.every((item) => item.status === "skipped")).toBe(true);
    expect(batch.items).toEqual([]);
    expect(snapshot?.currentBatch?.items).toHaveLength(3);
    expect(snapshot?.currentBatch?.items.every((item) => item.status === "skipped")).toBe(true);
    expect(vi.mocked(fixture.runtime.applyEntry)).toHaveBeenCalledTimes(1);
    await fixture.coordinator.close();
  });

  it("pauses after the active apply commit and resumes pending work without replay", async () => {
    const { promise: blocked, resolve: releaseFirst } = promiseWithResolvers<void>();
    const { promise: started, resolve: firstStarted } = promiseWithResolvers<void>();
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
    const pausing = fixture.coordinator.pause(previewHandle.task.id);
    releaseFirst();
    await pausing;

    const paused = await fixture.coordinator.getActiveSession();
    expect(paused?.currentBatch?.items.filter((item) => item.result)).toHaveLength(1);
    expect(paused?.currentBatch?.items.map((item) => item.status).sort()).toEqual(["failed", "pending"]);

    await fixture.coordinator.resume(previewHandle.task.id);
    const applied = await applyHandle.completion;
    expect(applied.applied).toHaveLength(2);
    expect(vi.mocked(fixture.runtime.applyEntry).mock.calls.map(([input]) => input.entry.fileId)).toEqual([
      "one.mp4",
      "two.mp4",
    ]);
    await fixture.coordinator.close();
  });

  it("keeps unselected drafts and derives the latest batch log and result from currentBatch", async () => {
    const fixture = createCoordinator({
      applyEntry: vi.fn(async ({ entry }) => ({ status: "failed" as const, error: entry.fileId })),
    });
    const previewHandle = await fixture.coordinator.startPreview({
      rootId: root.id,
      presetId: "organize_files",
      refs: [{ relativePath: "one.mp4" }, { relativePath: "two.mp4" }],
    });
    const previewBatch = await previewHandle.completion;
    const [first, second] = previewBatch.items;
    await fixture.coordinator.updateDraft({
      taskId: previewHandle.task.id,
      previewId: first?.id ?? "",
      fieldSelections: { title: "new" },
    });
    await fixture.coordinator.updateDraft({
      taskId: previewHandle.task.id,
      previewId: second?.id ?? "",
      fieldSelections: { title: "old" },
    });

    const apply = await fixture.coordinator.beginApply({
      taskId: previewHandle.task.id,
      selections: [{ previewId: first?.id ?? "", fieldSelections: { title: "new" } }],
    });
    await apply.completion;
    const snapshot = await fixture.coordinator.getActiveSession();

    expect(snapshot?.previews.map((item) => item.id)).toEqual([second?.id]);
    expect(snapshot?.draft.fieldSelections).toEqual({ [second?.id ?? ""]: { title: "old" } });
    expect(snapshot?.currentBatch?.items).toHaveLength(1);
    expect(snapshot?.currentBatch?.items[0]?.result).toMatchObject({ status: "failed", error: "one.mp4" });
    await fixture.coordinator.close();
  });

  it("drops a result from an old generation before the library transaction", async () => {
    const { promise: blocked, resolve: releaseApply } = promiseWithResolvers<void>();
    const { promise: started, resolve: applyStarted } = promiseWithResolvers<void>();
    const outputPath = fileURLToPath(import.meta.url);
    const fixture = createCoordinator({
      applyEntry: vi.fn(async ({ entry }) => {
        applyStarted();
        await blocked;
        return {
          status: "success" as const,
          entry: { ...entry, fileInfo: { ...entry.fileInfo, filePath: outputPath } },
          outputRelativePath: "one.mp4",
        };
      }),
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
    await started;
    const stopping = fixture.coordinator.stop(preview.task.id);
    releaseApply();
    await stopping;
    const batch = await apply.completion;

    expect(fixture.library.publishRefresh).not.toHaveBeenCalled();
    expect(batch.applied).toEqual([expect.objectContaining({ status: "skipped" })]);
    await fixture.coordinator.close();
  });
});
