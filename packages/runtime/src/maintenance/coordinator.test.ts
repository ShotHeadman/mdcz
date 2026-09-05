import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMediaRoot, resolveRootRelativePath } from "@mdcz/media-store";
import type { LocalScanEntry } from "@mdcz/shared/types";
import { describe, expect, it, vi } from "vitest";
import { MediaPathOwnership } from "../library/mediaPathOwnership";
import { MaintenanceSessionCoordinator } from "./coordinator";
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
const ref = (relativePath: string) => ({ rootId: root.id, relativePath });

const createEntry = (relativePath: string, mediaRoot = root): LocalScanEntry => ({
  fileId: relativePath,
  ref: { rootId: mediaRoot.id, relativePath },
  fileInfo: {
    filePath: resolveRootRelativePath(mediaRoot, relativePath),
    fileName: relativePath,
    extension: ".mp4",
    number: relativePath.replace(/\.mp4$/u, ""),
    isSubtitled: false,
  },
  assets: { sceneImages: [], actorPhotos: [] },
  currentDir: mediaRoot.hostPath,
});

const toRuntimePreview = (entry: LocalScanEntry) => ({
  entry,
  rootId: entry.ref.rootId,
  relativePath: entry.ref.relativePath ?? entry.fileInfo.fileName,
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

const createCoordinator = (runtimeOverrides: Partial<MaintenanceRuntime> = {}, roots = [root]) => {
  const runtime = {
    scanRefs: vi.fn(async ({ root: scanRoot, refs }: { root: typeof root; refs: Array<{ relativePath: string }> }) =>
      refs.map((ref) => createEntry(ref.relativePath, scanRoot)),
    ),
    previewEntries: vi.fn(async ({ entries }: { entries: LocalScanEntry[] }) => entries.map(toRuntimePreview)),
    applyEntry: vi.fn(),
    ...runtimeOverrides,
  } as unknown as MaintenanceRuntime;
  const events: unknown[] = [];
  const ownership = new MediaPathOwnership();
  const library = {
    resolveSource: vi.fn(async () => null),
    preflightRefresh: vi.fn(async () => undefined),
    publishRefresh: vi.fn(async () => ({ libraryItemId: "test-item" })),
  };
  const coordinator = new MaintenanceSessionCoordinator({
    roots: {
      get: async (rootId) => {
        const selected = roots.find((candidate) => candidate.id === rootId);
        if (!selected) throw new Error(`Unknown root: ${rootId}`);
        return selected;
      },
      list: async () => roots,
    },
    runtime,
    library,
    events: {
      publish: (event) => {
        events.push(event);
      },
    },
    acquireAll: (refs, owner) => ownership.acquireAll(refs, owner),
  });
  return { coordinator, events, library, ownership, runtime };
};

describe("MaintenanceSessionCoordinator", () => {
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
      refs: [ref("one.mp4")],
    });
    await first.completion;

    await fixture.coordinator.discardSession(first.session.id);
    expect(await fixture.coordinator.getActiveSession()).toBeNull();

    const second = await fixture.coordinator.startPreview({
      rootId: root.id,
      presetId: "refresh_data",
      refs: [ref("two.mp4")],
    });
    expect(second.session.id).not.toBe(first.session.id);
    await second.completion;
    await fixture.coordinator.close();
  });

  it("scans selected refs exactly once when starting a preview", async () => {
    const scanRefs = vi.fn(async () => [createEntry("one.mp4")]);
    const fixture = createCoordinator({ scanRefs });

    const handle = await fixture.coordinator.startPreview({
      rootId: root.id,
      presetId: "read_local",
      refs: [ref("one.mp4")],
    });
    const batch = await handle.completion;

    expect(handle.session).toMatchObject({ phase: "preview", refs: [ref("one.mp4")] });
    expect(fixture.events).toContainEqual({
      kind: "session-changed",
      session: expect.objectContaining({
        status: "queued",
        previews: [expect.objectContaining({ relativePath: "one.mp4", status: "pending" })],
      }),
    });
    expect(fixture.events).toContainEqual({
      kind: "session-changed",
      session: expect.objectContaining({
        status: "running",
        previews: [expect.objectContaining({ relativePath: "one.mp4", status: "processing" })],
      }),
    });
    expect(fixture.events).toContainEqual({
      kind: "session-changed",
      session: expect.objectContaining({
        status: "completed",
        completedEntries: 1,
        previews: [expect.objectContaining({ relativePath: "one.mp4", status: "ready" })],
      }),
    });
    expect(scanRefs).toHaveBeenCalledTimes(1);
    expect(batch.items.map((item) => item.relativePath)).toEqual(["one.mp4"]);
    await fixture.coordinator.close();
  });

  it("canonicalizes overlapping-root refs before preview and apply", async () => {
    const nestedRoot = createMediaRoot({
      id: "root-2",
      displayName: "Nested",
      hostPath: join(root.hostPath, "nested"),
    });
    const fixture = createCoordinator(
      { applyEntry: vi.fn(async ({ entry }) => ({ status: "failed" as const, error: entry.fileId })) },
      [root, nestedRoot],
    );
    const preview = await fixture.coordinator.startPreview({
      rootId: root.id,
      presetId: "organize_files",
      refs: [ref("one.mp4"), ref("nested/two.mp4")],
    });
    const previewBatch = await preview.completion;
    const apply = await fixture.coordinator.beginApply({
      sessionId: preview.session.id,
      selections: previewBatch.items.map((item) => ({ previewId: item.id })),
    });
    await apply.completion;

    expect(previewBatch.items.map((item) => item.rootId).sort()).toEqual([root.id, nestedRoot.id]);
    expect(
      vi
        .mocked(fixture.runtime.applyEntry)
        .mock.calls.map(([input]) => input.root.id)
        .sort(),
    ).toEqual([root.id, nestedRoot.id]);
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
      refs: [ref("one.mp4")],
    });
    const previewBatch = await preview.completion;
    const apply = await fixture.coordinator.beginApply({
      sessionId: preview.session.id,
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
      refs: [ref("one.mp4")],
    });
    const previewBatch = await preview.completion;
    const apply = await fixture.coordinator.beginApply({
      sessionId: preview.session.id,
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
      refs: ["one.mp4", "two.mp4", "three.mp4"].map(ref),
    });
    await started;
    const pausing = fixture.coordinator.pause(handle.session.id);
    const signal = vi.mocked(fixture.runtime.previewEntries).mock.calls[0]?.[0].signal;
    expect(signal?.aborted).toBe(false);
    releaseFirst();
    await expect(pausing).resolves.toMatchObject({ status: "paused" });
    expect((await fixture.coordinator.readPreview(handle.session.id)).items).toHaveLength(1);
    expect(vi.mocked(fixture.runtime.previewEntries)).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(false);

    await expect(fixture.coordinator.resume(handle.session.id)).resolves.toMatchObject({ status: "running" });
    const batch = await handle.completion;
    expect(batch.session.status).toBe("completed");
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
      refs: ["one.mp4", "two.mp4", "three.mp4"].map(ref),
    });
    const previewBatch = await preview.completion;
    const apply = await fixture.coordinator.beginApply({
      sessionId: preview.session.id,
      selections: previewBatch.items.map((item) => ({ previewId: item.id })),
    });
    await started;
    await fixture.coordinator.stop(preview.session.id);
    const batch = await apply.completion;
    const snapshot = await fixture.coordinator.getActiveSession();

    expect(batch.session).toMatchObject({ status: "failed", error: "维护已停止" });
    expect(batch.applied).toHaveLength(3);
    expect(new Set(batch.applied.map((item) => item.previewId)).size).toBe(3);
    expect(batch.applied.every((item) => item.status === "skipped")).toBe(true);
    expect(batch.items).toEqual([]);
    expect(snapshot?.currentBatch?.items).toHaveLength(3);
    expect(snapshot?.currentBatch?.items.every((item) => item.status === "skipped")).toBe(true);
    expect(vi.mocked(fixture.runtime.applyEntry)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fixture.runtime.applyEntry).mock.calls[0]?.[0].signal?.aborted).toBe(true);
    expect(fixture.events).toContainEqual({
      kind: "session-changed",
      session: expect.objectContaining({
        status: "failed",
        currentBatch: expect.objectContaining({
          items: expect.arrayContaining([expect.objectContaining({ status: "skipped" })]),
        }),
      }),
    });
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
      refs: [ref("one.mp4"), ref("two.mp4")],
    });
    const previewBatch = await previewHandle.completion;
    const applyHandle = await fixture.coordinator.beginApply({
      sessionId: previewHandle.session.id,
      selections: previewBatch.items.map((item) => ({ previewId: item.id })),
    });
    await started;
    const pausing = fixture.coordinator.pause(previewHandle.session.id);
    releaseFirst();
    await pausing;

    const paused = await fixture.coordinator.getActiveSession();
    expect(paused?.currentBatch?.items.filter((item) => item.result)).toHaveLength(1);
    expect(paused?.currentBatch?.items.map((item) => item.status).sort()).toEqual(["failed", "pending"]);

    await fixture.coordinator.resume(previewHandle.session.id);
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
      refs: [ref("one.mp4"), ref("two.mp4")],
    });
    const previewBatch = await previewHandle.completion;
    const [first, second] = previewBatch.items;
    await fixture.coordinator.updateDraft({
      sessionId: previewHandle.session.id,
      previewId: first?.id ?? "",
      fieldSelections: { title: "new" },
    });
    await fixture.coordinator.updateDraft({
      sessionId: previewHandle.session.id,
      previewId: second?.id ?? "",
      fieldSelections: { title: "old" },
    });

    const apply = await fixture.coordinator.beginApply({
      sessionId: previewHandle.session.id,
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
      refs: [ref("one.mp4")],
    });
    const previewBatch = await preview.completion;
    const apply = await fixture.coordinator.beginApply({
      sessionId: preview.session.id,
      selections: [{ previewId: previewBatch.items[0]?.id ?? "" }],
    });
    await started;
    const stopping = fixture.coordinator.stop(preview.session.id);
    releaseApply();
    await stopping;
    const batch = await apply.completion;

    expect(fixture.library.publishRefresh).not.toHaveBeenCalled();
    expect(batch.applied).toEqual([expect.objectContaining({ status: "skipped" })]);
    await fixture.coordinator.close();
  });

  it("holds media path ownership through apply and releases it on stop", async () => {
    const { promise: started, resolve: applyStarted } = promiseWithResolvers<void>();
    const fixture = createCoordinator({
      applyEntry: vi.fn(async ({ signal }) => {
        const { promise, reject } = promiseWithResolvers<never>();
        applyStarted();
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        return await promise;
      }),
    });
    const preview = await fixture.coordinator.startPreview({
      rootId: root.id,
      presetId: "organize_files",
      refs: [ref("owned.mp4")],
    });
    const previewBatch = await preview.completion;
    await fixture.coordinator.beginApply({
      sessionId: preview.session.id,
      selections: [{ previewId: previewBatch.items[0]?.id ?? "" }],
    });
    await started;

    expect(() => fixture.ownership.acquire(root.id, "owned.mp4")).toThrow("Media path is already being modified");
    await fixture.coordinator.stop(preview.session.id);
    const release = fixture.ownership.acquire(root.id, "owned.mp4");
    release();
    await fixture.coordinator.close();
  });

  it.each(["completed", "failed"] as const)("releases media path ownership when apply is %s", async (outcome) => {
    const outputPath = fileURLToPath(import.meta.url);
    const fixture = createCoordinator({
      applyEntry: vi.fn(async ({ entry }) =>
        outcome === "failed"
          ? { status: "failed" as const, error: "apply failed" }
          : {
              status: "success" as const,
              entry,
              outputRelativePath: "owned.mp4",
              plan: {
                video: { sourcePath: outputPath, targetPath: outputPath, size: 1 },
                artifacts: [],
                assets: [],
                obsoletePaths: [],
              },
            },
      ),
    });
    const preview = await fixture.coordinator.startPreview({
      rootId: root.id,
      presetId: "organize_files",
      refs: [ref("owned.mp4")],
    });
    const previewBatch = await preview.completion;
    const apply = await fixture.coordinator.beginApply({
      sessionId: preview.session.id,
      selections: [{ previewId: previewBatch.items[0]?.id ?? "" }],
    });
    await apply.completion;

    const release = fixture.ownership.acquire(root.id, "owned.mp4");
    release();
    await fixture.coordinator.close();
  });
});
