import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createMediaRoot, resolveRootRelativePath } from "@mdcz/media-store";
import { defaultConfiguration } from "@mdcz/shared/config";
import type { LocalScanEntry } from "@mdcz/shared/types";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { PublicationConflictError } from "../publication/conflicts";
import type { PublicationJournalPort } from "../publication/types";
import { type MaintenancePersistencePort, MaintenanceSessionCoordinator } from "./coordinator";
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
  affectedFiles: [{ fileId: entry.fileId, currentPath: entry.fileInfo.filePath, targetPath: entry.fileInfo.filePath }],
  files: [entry],
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

const createCoordinator = (
  runtimeOverrides: Partial<MaintenanceRuntime> = {},
  roots = [root],
  overrides: Partial<ConstructorParameters<typeof MaintenanceSessionCoordinator>[0]> = {},
) => {
  const runtime = {
    getConfiguration: vi.fn(async () => structuredClone(defaultConfiguration)),
    scanRefs: vi.fn(async ({ root: scanRoot, refs }: { root: typeof root; refs: Array<{ relativePath: string }> }) =>
      refs.map((ref) => createEntry(ref.relativePath, scanRoot)),
    ),
    previewMovie: vi.fn(async ({ entry }: { entry: LocalScanEntry }) => toRuntimePreview(entry)),
    applyEntry: vi.fn(),
    ...runtimeOverrides,
  } as unknown as MaintenanceRuntime;
  runtime.createSession = vi.fn(async () => runtime);
  const events: unknown[] = [];
  const library = {
    inventoryOwnership: vi.fn<Awaited<ReturnType<MaintenancePersistencePort["get"]>>["library"]["inventoryOwnership"]>(
      () => [],
    ),
    writeEntry: vi.fn(() => "test-item"),
  };
  const publicationJournal: PublicationJournalPort = {
    begin: vi.fn(),
    commit: <T>(_operationId: string, commit: () => T): T => commit(),
    finish: vi.fn(),
    listUnfinished: vi.fn(() => []),
  };
  const coordinator = new MaintenanceSessionCoordinator({
    roots: {
      assertRootIntegrity: vi.fn(async () => undefined),
      get: async (rootId) => {
        const selected = roots.find((candidate) => candidate.id === rootId);
        if (!selected) throw new Error(`Unknown root: ${rootId}`);
        return selected;
      },
      list: async () => roots,
    },
    runtime,
    persistence: {
      get: async () => ({
        library: library as unknown as import("@mdcz/persistence").LibraryRepository,
        publicationJournal,
      }),
    },
    events: {
      publish: (event) => {
        events.push(event);
      },
    },
    ...overrides,
  });
  return { coordinator, events, library, publicationJournal, runtime };
};

describe("MaintenanceSessionCoordinator", () => {
  it("fixes ownership and reuses preview observations throughout apply", async () => {
    const fixture = createCoordinator({
      applyEntry: vi.fn(async ({ entry }) => ({
        status: "success" as const,
        entry,
        outputRelativePath: entry.ref.relativePath,
      })),
    });
    fixture.library.inventoryOwnership.mockReturnValue([
      { rootId: root.id, relativePath: "one.mp4", movieId: "movie-1", fileId: "file-1", kind: "video", published: 1 },
    ]);
    const preview = await fixture.coordinator.startPreview({
      rootId: root.id,
      presetId: "refresh_metadata",
      refs: [ref("one.mp4")],
    });
    const batch = await preview.completion;
    expect(batch.items[0].movieGroup?.files[0].fileId).toBe("file-1");
    fixture.library.inventoryOwnership.mockReturnValue([]);
    const apply = await fixture.coordinator.beginApply({
      sessionId: preview.session.id,
      selections: [{ previewId: batch.items[0].id }],
    });
    expect((await apply.completion).applied[0].status).toBe("success");
    expect(fixture.library.inventoryOwnership).toHaveBeenCalledOnce();
    expect(fixture.runtime.scanRefs).toHaveBeenCalledOnce();
    expect(vi.mocked(fixture.runtime.applyEntry).mock.calls[0][0].files).toEqual(batch.items[0].files);
    await fixture.coordinator.close();
  });
  it.each([
    "files",
    "empty",
    "failed",
    "stopped",
    "interrupted",
  ] as const)("owns directory discovery throughout its session (%s)", async (outcome) => {
    const entered = promiseWithResolvers<void>();
    const release = promiseWithResolvers<void>();
    let signal: AbortSignal | undefined;
    let rerunning = false;
    const fixture = createCoordinator({}, [root], {
      discoverDirectory: async (_scope, _configuration, currentSignal, report) => {
        signal = currentSignal;
        report({ directories: 1, candidates: 0, elapsedMs: 1, skipped: 0, currentPath: root.hostPath, warnings: [] });
        entered.resolve();
        await release.promise;
        currentSignal.throwIfAborted();
        if (outcome === "failed") throw new Error("mount failed");
        return outcome === "empty" ? [] : [ref(rerunning ? "new.mp4" : "one.mp4")];
      },
    });
    const handle = await fixture.coordinator.startPreview({
      rootId: root.id,
      presetId: "inspect_local",
      refs: [],
      configuration: defaultConfiguration,
      directoryScope: {
        kind: "directory",
        scanDir: root.hostPath,
        recursive: true,
        targetDir: root.hostPath,
        excludeDirPaths: [],
      },
    });
    const completion = handle.completion.then(
      (batch) => batch,
      (error: unknown) => error,
    );
    await entered.promise;
    expect(await fixture.coordinator.getActiveSession()).toMatchObject({
      status: "discovering",
      totalEntries: null,
      refs: [],
    });
    expect(fixture.runtime.scanRefs).not.toHaveBeenCalled();
    await expect(fixture.coordinator.pause(handle.session.id)).rejects.toThrow("不支持暂停");
    const termination =
      outcome === "stopped"
        ? fixture.coordinator.stop(handle.session.id)
        : outcome === "interrupted"
          ? fixture.coordinator.close()
          : null;
    if (termination) expect(signal?.aborted).toBe(true);
    release.resolve();
    await termination;
    await completion;
    expect(await fixture.coordinator.getActiveSession()).toMatchObject({
      status: outcome === "files" || outcome === "empty" ? "completed" : outcome,
    });
    expect(fixture.runtime.scanRefs).toHaveBeenCalledTimes(outcome === "files" ? 1 : 0);
    expect(fixture.runtime.applyEntry).not.toHaveBeenCalled();
    if (outcome !== "interrupted") {
      rerunning = true;
      const rerun = await fixture.coordinator.rerunDirectory(handle.session.id);
      expect(rerun.session.id).not.toBe(handle.session.id);
      if (outcome === "failed") await expect(rerun.completion).rejects.toThrow("mount failed");
      else await rerun.completion;
      expect(vi.mocked(fixture.runtime.createSession).mock.calls.at(-1)?.[0].configuration).toEqual(
        defaultConfiguration,
      );
      expect((await fixture.coordinator.getActiveSession())?.refs).toEqual(
        outcome === "empty" || outcome === "failed" ? [] : [ref("new.mp4")],
      );
    }
    await fixture.coordinator.close();
  });
  it("reserves preview startup against concurrent previews and applies and releases it after scan failure", async () => {
    const scanning = promiseWithResolvers<void>();
    const scanned = promiseWithResolvers<LocalScanEntry[]>();
    const fixture = createCoordinator();
    const input = { rootId: root.id, presetId: "inspect_local" as const, refs: [ref("one.mp4")] };
    const first = await fixture.coordinator.startPreview(input);
    const batch = await first.completion;
    vi.mocked(fixture.runtime.scanRefs).mockImplementationOnce(async () => {
      scanning.resolve();
      return await scanned.promise;
    });
    const starting = await fixture.coordinator.startPreview(input);
    const failed = expect(starting.completion).rejects.toThrow("scan failed");
    await scanning.promise;
    await expect(fixture.coordinator.startPreview(input)).rejects.toThrow("已有活动的维护会话");
    await expect(
      fixture.coordinator.beginApply({
        sessionId: first.session.id,
        selections: [{ previewId: batch.items[0].id }],
      }),
    ).rejects.toThrow("Maintenance session not found");
    scanned.reject(new Error("scan failed"));
    await failed;
    const retry = await fixture.coordinator.startPreview(input);
    await retry.completion;
    await fixture.coordinator.close();
  });

  it("discards a completed session before starting a new one", async () => {
    const fixture = createCoordinator();
    const first = await fixture.coordinator.startPreview({
      rootId: root.id,
      presetId: "refresh_metadata",
      refs: [ref("one.mp4")],
    });
    await first.completion;

    await fixture.coordinator.discardSession(first.session.id);
    expect(await fixture.coordinator.getActiveSession()).toBeNull();

    const second = await fixture.coordinator.startPreview({
      rootId: root.id,
      presetId: "refresh_metadata",
      refs: [ref("two.mp4")],
    });
    expect(second.session.id).not.toBe(first.session.id);
    await second.completion;
    await fixture.coordinator.close();
  });

  it.each([
    "inspect_local",
    "local_organize",
  ] as const)("scans unregistered refs once and retains their %s layout", async (presetId) => {
    const scanRefs = vi.fn(async () => [createEntry("one.mp4")]);
    const targetPath = resolveRootRelativePath(root, "organized/one.mp4");
    const fixture = createCoordinator({
      scanRefs,
      previewMovie: vi.fn(async ({ entry }) => ({
        ...toRuntimePreview(entry),
        affectedFiles: [{ fileId: entry.fileId, currentPath: entry.fileInfo.filePath, targetPath }],
      })),
    });

    const handle = await fixture.coordinator.startPreview({
      rootId: root.id,
      presetId,
      refs: [ref("one.mp4")],
    });
    const batch = await handle.completion;

    expect(handle.session).toMatchObject({ phase: "preview", refs: [ref("one.mp4")] });
    expect(fixture.events).toContainEqual({
      kind: "session-changed",
      session: expect.objectContaining({
        status: "running",
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
    expect(batch.items[0]?.affectedFiles).toEqual([
      { fileId: `${root.id}:one.mp4`, currentPath: createEntry("one.mp4").fileInfo.filePath, targetPath },
    ]);
    expect(batch.items[0]?.affectedFiles?.map((file) => file.fileId)).toEqual(
      batch.items[0]?.movieGroup?.files.map((file) => file.fileId),
    );
    if (presetId === "inspect_local") {
      await expect(
        fixture.coordinator.beginApply({
          sessionId: handle.session.id,
          selections: [{ previewId: batch.items[0].id }],
        }),
      ).rejects.toThrow("不支持执行");
      expect(fixture.runtime.applyEntry).not.toHaveBeenCalled();
    }
    await fixture.coordinator.close();
  });

  it("preserves registered namespaces for overlapping-root refs before preview and apply", async () => {
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
      presetId: "local_organize",
      refs: [ref("one.mp4"), ref("nested/two.mp4")],
    });
    const previewBatch = await preview.completion;
    const apply = await fixture.coordinator.beginApply({
      sessionId: preview.session.id,
      selections: previewBatch.items.map((item) => ({ previewId: item.id })),
    });
    await apply.completion;

    expect(previewBatch.items.map((item) => item.rootId).sort()).toEqual([root.id, root.id]);
    expect(
      vi
        .mocked(fixture.runtime.applyEntry)
        .mock.calls.map(([input]) => input.root.id)
        .sort(),
    ).toEqual([root.id, root.id]);
    await fixture.coordinator.close();
  });

  it("refreshes the network policy before each preview and apply phase", async () => {
    let policyVersion = 0;
    const fixture = createCoordinator({
      applyNetworkPolicy: vi.fn(async () => {
        policyVersion += 1;
      }),
      previewMovie: vi.fn(async ({ entry }: { entry: LocalScanEntry }) => {
        expect(policyVersion).toBe(1);
        return toRuntimePreview(entry);
      }),
      applyEntry: vi.fn(async ({ entry }) => {
        expect(policyVersion).toBe(2);
        return { status: "failed" as const, error: entry.fileId };
      }),
    });

    const preview = await fixture.coordinator.startPreview({
      rootId: root.id,
      presetId: "local_organize",
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

  it.each(["conflict", "failure"] as const)("continues the batch after a movie %s", async (outcome) => {
    const fixture = createCoordinator({
      applyEntry: vi.fn(async ({ entry }) => {
        if (entry.fileInfo.number === "one") {
          if (outcome === "conflict") throw new PublicationConflictError("source", "target", "occupied");
          throw new Error("database unavailable");
        }
        return { status: "success" as const, entry, outputRelativePath: entry.ref.relativePath };
      }),
    });
    const preview = await fixture.coordinator.startPreview({
      rootId: root.id,
      presetId: "local_organize",
      refs: [ref("one.mp4"), ref("two.mp4")],
    });
    const batch = await preview.completion;
    const apply = await fixture.coordinator.beginApply({
      sessionId: preview.session.id,
      selections: batch.items.map((item) => ({ previewId: item.id })),
    });
    const result = await apply.completion;
    expect(result.applied.map((item) => item.status)).toEqual([
      outcome === "conflict" ? "skipped" : "failed",
      "success",
    ]);
    expect(result.session).toMatchObject({ status: "completed", successCount: 1, failedCount: 1 });
    await fixture.coordinator.close();
  });

  it("commits the active preview once while paused and resumes only pending refs", async () => {
    const { promise: blocked, resolve: releaseFirst } = promiseWithResolvers<void>();
    const { promise: started, resolve: firstStarted } = promiseWithResolvers<void>();
    const fixture = createCoordinator();
    vi.mocked(fixture.runtime.previewMovie).mockImplementation(async ({ entry }) => {
      firstStarted();
      if (entry.fileId === "one.mp4") await blocked;
      return toRuntimePreview(entry);
    });
    const handle = await fixture.coordinator.startPreview({
      rootId: root.id,
      presetId: "refresh_metadata",
      refs: ["one.mp4", "two.mp4", "three.mp4"].map(ref),
    });
    await started;
    const pausing = fixture.coordinator.pause(handle.session.id);
    const signal = vi.mocked(fixture.runtime.previewMovie).mock.calls[0]?.[0].signal;
    expect(signal?.aborted).toBe(false);
    releaseFirst();
    await expect(pausing).resolves.toMatchObject({ status: "paused" });
    expect((await fixture.coordinator.readPreview(handle.session.id)).items).toHaveLength(1);
    expect(vi.mocked(fixture.runtime.previewMovie)).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(false);

    await expect(fixture.coordinator.resume(handle.session.id)).resolves.toMatchObject({ status: "running" });
    const batch = await handle.completion;
    expect(batch.session.status).toBe("completed");
    expect(batch.items.map((item) => item.relativePath)).toEqual(["one.mp4", "three.mp4", "two.mp4"]);
    expect(vi.mocked(fixture.runtime.previewMovie)).toHaveBeenCalledTimes(3);
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
      presetId: "local_organize",
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

    expect(batch.session).toMatchObject({ status: "stopped", error: "维护已停止" });
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
        status: "stopped",
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
      if (entry.fileId.endsWith("one.mp4")) {
        firstStarted();
        await blocked;
      }
      return { status: "failed", error: entry.fileId };
    });
    const previewHandle = await fixture.coordinator.startPreview({
      rootId: root.id,
      presetId: "local_organize",
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
      `${root.id}:one.mp4`,
      `${root.id}:two.mp4`,
    ]);
    await fixture.coordinator.close();
  });

  it("keeps unselected drafts and derives the latest batch log and result from currentBatch", async () => {
    const fixture = createCoordinator({
      applyEntry: vi.fn(async ({ entry }) => ({ status: "failed" as const, error: entry.fileId })),
    });
    const previewHandle = await fixture.coordinator.startPreview({
      rootId: root.id,
      presetId: "local_organize",
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
    expect(snapshot?.currentBatch?.items[0]?.result).toMatchObject({
      status: "failed",
      error: `${root.id}:one.mp4`,
    });
    await fixture.coordinator.close();
  });

  it.each([false, true])("records the actual output result when stopping (committed=%s)", async (committed) => {
    const { promise: blocked, resolve: releaseApply } = promiseWithResolvers<void>();
    const { promise: started, resolve: applyStarted } = promiseWithResolvers<void>();
    const outputPath = fileURLToPath(import.meta.url);
    const fixture = createCoordinator({
      applyEntry: vi.fn(async ({ entry, signal }) => {
        applyStarted();
        await blocked;
        if (!committed) signal?.throwIfAborted();
        return {
          status: "success" as const,
          entry: { ...entry, fileInfo: { ...entry.fileInfo, filePath: outputPath } },
          outputRelativePath: "one.mp4",
        };
      }),
    });
    const preview = await fixture.coordinator.startPreview({
      rootId: root.id,
      presetId: "local_organize",
      refs: [ref(relative(root.hostPath, outputPath))],
    });
    const previewBatch = await preview.completion;
    const apply = await fixture.coordinator.beginApply({
      sessionId: preview.session.id,
      selections: [{ previewId: previewBatch.items[0]?.id ?? "" }],
    });
    await started;
    const stopping = fixture.coordinator.stop(preview.session.id);
    const repeatedStop = fixture.coordinator.stop(preview.session.id);
    releaseApply();
    await Promise.all([stopping, repeatedStop]);
    const batch = await apply.completion;
    expect(fixture.library.writeEntry).not.toHaveBeenCalled();
    expect(batch.applied).toEqual([expect.objectContaining({ status: committed ? "success" : "skipped" })]);
    await fixture.coordinator.close();
  });

  it.each([
    { closeFirst: false, notificationFails: false },
    { closeFirst: true, notificationFails: false },
    { closeFirst: false, notificationFails: true },
    { closeFirst: true, notificationFails: true },
  ])("settles overlapping termination ($closeFirst, $notificationFails)", async ({ closeFirst, notificationFails }) => {
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
      presetId: "local_organize",
      refs: [ref("owned.mp4")],
    });
    const previewBatch = await preview.completion;
    const apply = await fixture.coordinator.beginApply({
      sessionId: preview.session.id,
      selections: [{ previewId: previewBatch.items[0]?.id ?? "" }],
    });
    await started;

    if (notificationFails)
      vi.spyOn(fixture.events, "push").mockImplementation(() => {
        throw new Error("notification unavailable");
      });
    const first = closeFirst ? fixture.coordinator.close() : fixture.coordinator.stop(preview.session.id);
    const second = closeFirst ? fixture.coordinator.stop(preview.session.id) : fixture.coordinator.close();
    const settlements = await Promise.allSettled([first, second]);
    expect(settlements.map((settlement) => settlement.status)).toEqual([
      notificationFails ? "rejected" : "fulfilled",
      notificationFails ? "rejected" : "fulfilled",
    ]);
    const batch = await apply.completion;
    expect(batch.session.status).toBe(closeFirst ? "interrupted" : "stopped");
    expect(batch.applied).toEqual([expect.objectContaining({ status: "skipped" })]);
    expect(vi.mocked(fixture.runtime.applyEntry)).toHaveBeenCalledOnce();
  });

  it("admits entry identities, expands parts, and rejects duplicate parts and generated STRMs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mdcz-maintenance-groups-"));
    onTestFinished(() => rm(directory, { recursive: true, force: true }));
    await mkdir(join(directory, "nested"));
    const names = ["ABC-123-CD1.mp4", "ABC-123-CD2.mp4"];
    for (const name of names) await writeFile(join(directory, "nested", name), "video");
    const parent = createMediaRoot({ id: "parent", displayName: "Parent", hostPath: directory });
    const nested = createMediaRoot({ id: "nested", displayName: "Nested", hostPath: join(directory, "nested") });
    const fixture = createCoordinator({}, [parent, nested]);
    onTestFinished(() => fixture.coordinator.close());
    const selected = { rootId: parent.id, relativePath: `nested/${names[0]}` };
    const preview = await fixture.coordinator.startPreview({
      rootId: parent.id,
      presetId: "local_organize",
      refs: [selected, selected, { rootId: nested.id, relativePath: names[0] }],
    });
    const batch = await preview.completion;
    expect(batch.items).toHaveLength(1);
    expect(batch.items[0].movieGroup?.files.map((file) => file.relativePath)).toEqual(
      names.map((name) => `nested/${name}`),
    );

    fixture.library.inventoryOwnership.mockReturnValue([
      { ...selected, movieId: "existing", fileId: "owned", kind: "video", published: 1 },
    ]);
    const owned = await fixture.coordinator.startPreview({
      rootId: nested.id,
      presetId: "inspect_local",
      refs: [{ rootId: nested.id, relativePath: names[0] }],
    });
    expect((await owned.completion).items[0].movieGroup).toMatchObject({
      movieId: "existing",
      files: [{ rootId: nested.id, relativePath: names[0], fileId: "owned" }],
    });

    fixture.library.inventoryOwnership.mockReturnValue([]);
    await writeFile(join(directory, "nested", "ABC-123-CD01.mkv"), "duplicate");
    await expect(
      fixture.coordinator.startPreview({
        rootId: parent.id,
        presetId: "local_organize",
        refs: [selected],
      }),
    ).rejects.toThrow("重复分盘号");

    fixture.library.inventoryOwnership.mockReturnValue([
      {
        rootId: nested.id,
        relativePath: "generated.strm",
        movieId: "existing",
        fileId: null,
        kind: "strm",
        published: 1,
      },
    ]);
    await writeFile(join(directory, "nested", "generated.strm"), names[0]);
    await expect(
      fixture.coordinator.startPreview({
        rootId: nested.id,
        presetId: "local_organize",
        refs: [{ rootId: nested.id, relativePath: "generated.strm" }],
      }),
    ).rejects.toThrow("生成的视频附属文件");
  });
});
