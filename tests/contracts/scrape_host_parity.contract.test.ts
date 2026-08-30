import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultConfiguration } from "@main/services/config";
import { DesktopPersistenceService } from "@main/services/persistence";
import { SignalService } from "@main/services/SignalService";
import { MaintenanceService } from "@main/services/scraper/maintenance/MaintenanceService";
import { ScraperService } from "@main/services/scraper/ScraperService";
import { createMediaRoot } from "@mdcz/media-store";
import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import { DESKTOP_OUTPUT_ROOT_ID } from "@mdcz/runtime/library";
import type { MaintenanceRuntime } from "@mdcz/runtime/maintenance";
import { NetworkClient } from "@mdcz/runtime/network";
import type { PublicationPlan } from "@mdcz/runtime/publication";
import type { FileScrapeOptions, FileScrapeResult, MountedRootScrapeRuntime } from "@mdcz/runtime/scrape";
import { FileScraper } from "@mdcz/runtime/scrape";
import type { CrawlerData, LocalScanEntry, ScrapeResult } from "@mdcz/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerConfigService } from "../../apps/server/src/services/configService";
import { MaintenanceService as ServerMaintenanceService } from "../../apps/server/src/services/maintenanceService";
import { MediaRootService } from "../../apps/server/src/services/mediaRootService";
import { ServerPersistenceService } from "../../apps/server/src/services/persistenceService";
import { ScrapeService } from "../../apps/server/src/services/scrapeService";
import { TaskEventBus } from "../../apps/server/src/taskEvents";
import { mockConfigManager } from "../helpers/scraper";

type HostKind = "desktop" | "server";

interface HostHarness {
  start(relativePaths: string[]): Promise<{ runId: string }>;
  retry(runId: string): Promise<{ runId: string }>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  shutdown(): Promise<void>;
  waitUntilStarted(): Promise<void>;
  waitForIdle(): Promise<void>;
  disposition(runId: string): Promise<string | null>;
  libraryEntries(): Promise<Array<{ rootRelativePath: string }>>;
  applyMaintenance(relativePath: string): Promise<void>;
}

const directories: string[] = [];
const cleanups: Array<() => Promise<void>> = [];

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const crawlerData = (number: string): CrawlerData => ({
  title: `${number} title`,
  number,
  actors: [],
  genres: [],
  scene_images: [],
});

const failedResult = (relativePath: string, rootId: string): ScrapeResult => ({
  fileId: relativePath,
  rootId,
  relativePath,
  fileName: path.basename(relativePath),
  status: "failed",
  error: "contract failure",
  assets: [],
});

const successPlan = (source: { rootId: string; relativePath: string }, outputRootId: string): PublicationPlan => {
  const number = path.posix.basename(source.relativePath, path.posix.extname(source.relativePath)).toUpperCase();
  return {
    operationId: `${source.rootId}:${source.relativePath}`,
    operationType: "scrape",
    video: {
      source,
      target: { rootId: outputRootId, relativePath: `${number}/${number}.mp4` },
      size: 3,
    },
    artifacts: [],
    assets: [{ type: "local", kind: "poster", file: { rootId: outputRootId, relativePath: `${number}/poster.jpg` } }],
    obsolete: [],
  };
};

const desktopSuccessResult = (options: FileScrapeOptions, filePath: string): FileScrapeResult => {
  const source = options.source ?? { rootId: "local", relativePath: path.basename(filePath) };
  const outputRootId = options.roots?.some((root) => root.id === DESKTOP_OUTPUT_ROOT_ID)
    ? DESKTOP_OUTPUT_ROOT_ID
    : source.rootId;
  const plan = successPlan(source, outputRootId);
  const data = crawlerData(plan.video?.target.relativePath.split("/")[0] ?? "ONE");
  return {
    fileId: source.relativePath,
    rootId: source.rootId,
    relativePath: source.relativePath,
    fileName: path.basename(source.relativePath),
    status: "success",
    crawlerData: data,
    assets: plan.assets,
    nfo: {
      rootId: outputRootId,
      relativePath: plan.video?.target.relativePath.replace(/\.mp4$/u, ".nfo") ?? "ONE.nfo",
    },
    output: plan.video?.target,
    publicationPlan: { ...plan, operationId: options.operationId ?? plan.operationId },
  };
};

const waitForAbort = async (signal: AbortSignal | undefined, gate: Promise<void>): Promise<void> => {
  if (!signal) {
    await gate;
    return;
  }
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason));
  await Promise.race([
    gate,
    new Promise<never>((_, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason))),
        { once: true },
      );
    }),
  ]);
};

const mockMaintenanceRuntime = (): MaintenanceRuntime =>
  ({
    scan: vi.fn(async () => []),
    scanRefs: vi.fn(
      async ({ root, refs }: { root: { id: string; hostPath: string }; refs: Array<{ relativePath: string }> }) =>
        refs.map(
          (ref): LocalScanEntry => ({
            fileId: ref.relativePath,
            ref: { rootId: root.id, relativePath: ref.relativePath },
            fileInfo: {
              filePath: path.join(root.hostPath, ref.relativePath),
              fileName: path.basename(ref.relativePath),
              extension: path.extname(ref.relativePath),
              number: path.basename(ref.relativePath, path.extname(ref.relativePath)),
              isSubtitled: false,
            },
            assets: { sceneImages: [], actorPhotos: [] },
            currentDir: root.hostPath,
          }),
        ),
    ),
    previewEntries: vi.fn(async ({ root, entries }: { root: { id: string }; entries: LocalScanEntry[] }) =>
      entries.map((entry) => ({
        entry,
        rootId: root.id,
        relativePath: entry.ref.relativePath,
        status: "ready" as const,
        error: null,
        fieldDiffs: [],
        unchangedFieldDiffs: [],
        pathDiff: null,
        proposedCrawlerData: {
          title: "new title",
          number: entry.fileInfo.number,
          actors: [],
          genres: [],
          scene_images: [],
        },
      })),
    ),
    applyEntry: vi.fn(),
  }) as unknown as MaintenanceRuntime;

const createDesktopHost = async (mediaRoot: string, gate: Promise<void>, succeed: boolean): Promise<HostHarness> => {
  mockConfigManager({
    ...defaultConfiguration,
    paths: { ...defaultConfiguration.paths, mediaPath: mediaRoot },
  });
  const persistence = new DesktopPersistenceService(path.join(path.dirname(mediaRoot), "desktop.sqlite"), null);
  const root = createMediaRoot({ id: "desktop-root", displayName: "Media", hostPath: mediaRoot });
  await mkdir(path.join(mediaRoot, defaultConfiguration.paths.successOutputFolder), { recursive: true });
  const state = await persistence.initialize();
  await state.repositories.mediaRoots.upsert(root);
  const started = deferred<void>();
  const scrapeFile = vi
    .spyOn(FileScraper.prototype, "scrapeFile")
    .mockImplementation(async (filePath, _progress, signal, options) => {
      started.resolve();
      await waitForAbort(signal, gate);
      if (succeed) return desktopSuccessResult(options ?? {}, filePath);
      return failedResult(path.basename(filePath), options?.source?.rootId ?? root.id);
    });
  const signalService = new SignalService(null);
  const networkClient = new NetworkClient();
  const crawlerProvider = new CrawlerProvider({ fetchGateway: new FetchGateway(networkClient) });
  const service = new ScraperService(
    signalService,
    networkClient,
    crawlerProvider,
    undefined,
    undefined,
    undefined,
    undefined,
    persistence,
  );
  const maintenance = new MaintenanceService({
    signalService,
    networkClient,
    crawlerProvider,
    persistenceService: persistence,
    runtime: mockMaintenanceRuntime(),
  });
  cleanups.push(async () => {
    try {
      await service.shutdown({ timeoutMs: 1_000 });
      await maintenance.shutdown();
    } finally {
      scrapeFile.mockRestore();
      await persistence.close();
    }
  });
  return {
    start: async (relativePaths) => {
      const result = await service.startSelectedFiles(
        relativePaths.map((relativePath) => path.join(mediaRoot, relativePath)),
      );
      return { runId: result.taskId };
    },
    retry: async (runId) => ({ runId: (await service.retry(runId)).taskId }),
    pause: async () => await service.pause(),
    resume: async () => await service.resume(),
    stop: async () => {
      await service.stop();
    },
    shutdown: async () => await service.shutdown({ timeoutMs: 1_000 }),
    waitUntilStarted: async () => await started.promise,
    waitForIdle: async () => await service.waitForIdle(),
    disposition: async (runId) => (await state.repositories.scrapeRuns.get(runId)).disposition,
    libraryEntries: async () =>
      (await state.repositories.library.listEntries()).map((entry) => ({ rootRelativePath: entry.rootRelativePath })),
    applyMaintenance: async (relativePath) => {
      const filePath = path.join(mediaRoot, relativePath);
      const root = (await state.repositories.mediaRoots.list()).find((candidate) => candidate.hostPath === mediaRoot);
      if (!root) throw new Error("media root not registered");
      const entry: LocalScanEntry = {
        fileId: relativePath,
        ref: { rootId: root.id, relativePath },
        fileInfo: {
          filePath,
          fileName: path.basename(relativePath),
          extension: path.extname(relativePath),
          number: path.basename(relativePath, path.extname(relativePath)),
          isSubtitled: false,
        },
        assets: { sceneImages: [], actorPhotos: [] },
        currentDir: mediaRoot,
      };
      const preview = await maintenance.startPreview([entry.ref], "refresh_data");
      await preview.completion;
      const session = await maintenance.getActiveSession();
      const item = session?.previews[0];
      if (!session || !item) throw new Error("maintenance preview did not produce an item");
      await maintenance.execute(session.id, [{ previewId: item.id }], "refresh_data");
    },
  };
};

const createServerHost = async (mediaRoot: string, gate: Promise<void>, succeed: boolean): Promise<HostHarness> => {
  const directory = path.dirname(mediaRoot);
  const paths = {
    configDir: path.join(directory, "config"),
    dataDir: path.join(directory, "data"),
    configPath: path.join(directory, "config", "default.toml"),
    databasePath: ":memory:",
  };
  await mkdir(paths.configDir, { recursive: true });
  await mkdir(paths.dataDir, { recursive: true });
  const config = new ServerConfigService(paths);
  await config.load();
  const persistence = new ServerPersistenceService(paths);
  const mediaRoots = new MediaRootService(persistence);
  await persistence.initialize();
  const root = createMediaRoot({ id: "server-root", displayName: "Media", hostPath: mediaRoot });
  await (await persistence.getState()).repositories.mediaRoots.upsert(root);
  const started = deferred<void>();
  const runtime = {
    scrape: async (input) => {
      started.resolve();
      await waitForAbort(input.signal, gate);
      if (succeed) {
        const source = { rootId: input.root.id, relativePath: input.relativePath };
        const plan = successPlan(source, input.root.id);
        plan.operationId = input.operationId ?? plan.operationId;
        const data = crawlerData(
          path.posix.basename(input.relativePath, path.posix.extname(input.relativePath)).toUpperCase(),
        );
        const result: ScrapeResult = {
          fileId: input.relativePath,
          rootId: input.root.id,
          relativePath: input.relativePath,
          fileName: path.basename(input.relativePath),
          status: "success",
          crawlerData: data,
          assets: plan.assets,
          output: plan.video?.target,
        };
        return {
          status: "success" as const,
          result,
          crawlerData: data,
          nfoPath: null,
          outputRelativePath: plan.video?.target.relativePath ?? input.relativePath,
          size: 3,
          modifiedAt: null,
          plan,
        };
      }
      return {
        status: "failed" as const,
        error: "contract failure",
        result: failedResult(input.relativePath, input.root.id),
      };
    },
  } as MountedRootScrapeRuntime;
  const taskEvents = new TaskEventBus();
  const service = new ScrapeService(persistence, mediaRoots, config, taskEvents, {
    networkClient: new NetworkClient(),
    runtime,
    imageHostCooldownStore: { clear: () => undefined },
  });
  const maintenance = new ServerMaintenanceService(persistence, mediaRoots, taskEvents, mockMaintenanceRuntime());
  cleanups.push(async () => {
    try {
      await service.close();
      await maintenance.close();
    } finally {
      await persistence.close();
    }
  });
  return {
    start: async (relativePaths) => {
      const snapshot = await service.start({
        refs: relativePaths.map((relativePath) => ({ rootId: root.id, relativePath })),
      });
      return { runId: snapshot.task.id };
    },
    retry: async (runId) => ({ runId: (await service.retry({ taskId: runId })).task.id }),
    pause: async () => {
      const live = (await service.liveRuns()).runs[0];
      if (live) await service.pause({ taskId: live.task.id });
    },
    resume: async () => {
      const live = (await service.liveRuns()).runs[0];
      if (live) await service.resume({ taskId: live.task.id });
    },
    stop: async () => {
      const live = (await service.liveRuns()).runs[0];
      if (live) await service.stop({ taskId: live.task.id });
    },
    shutdown: async () => await service.close(),
    waitUntilStarted: async () => await started.promise,
    waitForIdle: async () => {
      await vi.waitFor(async () => {
        expect((await service.liveRuns()).runs).toHaveLength(0);
      });
    },
    disposition: async (runId) => (await (await persistence.getState()).repositories.scrapeRuns.get(runId)).disposition,
    libraryEntries: async () =>
      (await (await persistence.getState()).repositories.library.listEntries()).map((entry) => ({
        rootRelativePath: entry.rootRelativePath,
      })),
    applyMaintenance: async (relativePath) => {
      const startedMaintenance = await maintenance.start({
        rootId: root.id,
        presetId: "refresh_data",
        refs: [{ rootId: root.id, relativePath }],
      });
      await vi.waitFor(async () => {
        expect((await maintenance.getActiveSession())?.status).toBe("completed");
      });
      await maintenance.apply({
        sessionId: startedMaintenance.sessionId,
        confirmationToken: `maintenance:${startedMaintenance.sessionId}`,
      });
    },
  };
};

describe.each<HostKind>(["desktop", "server"])("scrape host parity: %s", (kind) => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    await Promise.all(
      directories.splice(0).map(async (directory) => await rm(directory, { recursive: true, force: true })),
    );
    vi.restoreAllMocks();
  });

  const createHost = async (gate: Promise<void>, succeed = false): Promise<HostHarness> => {
    const directory = await mkdtemp(path.join(tmpdir(), `mdcz-parity-${kind}-`));
    directories.push(directory);
    const mediaRoot = path.join(directory, "media");
    await mkdir(mediaRoot, { recursive: true });
    await writeFile(path.join(mediaRoot, "one.mp4"), "one");
    await writeFile(path.join(mediaRoot, "two.mp4"), "two");
    return kind === "desktop"
      ? await createDesktopHost(mediaRoot, gate, succeed)
      : await createServerHost(mediaRoot, gate, succeed);
  };

  it("commits a successful publication into the library", async () => {
    const gate = deferred<void>();
    gate.resolve();
    const host = await createHost(gate.promise, true);
    const started = await host.start(["one.mp4"]);
    await host.waitForIdle();
    expect(await host.disposition(started.runId)).toBe("completed");
    expect(await host.libraryEntries()).toEqual([expect.objectContaining({ rootRelativePath: "ONE/ONE.mp4" })]);
  });

  it("retries the same run id", async () => {
    const gate = deferred<void>();
    gate.resolve();
    const host = await createHost(gate.promise);
    const first = await host.start(["one.mp4"]);
    await host.waitForIdle();
    expect(await host.disposition(first.runId)).toBe("failed");

    const retry = await host.retry(first.runId);
    await host.waitForIdle();
    expect(retry.runId).toBe(first.runId);
    expect(await host.disposition(retry.runId)).toBe("failed");
  });

  it("interrupts unfinished work on shutdown", async () => {
    const hanging = deferred<void>();
    const host = await createHost(hanging.promise);
    const live = await host.start(["one.mp4"]);
    await host.waitUntilStarted();
    await host.shutdown();
    expect(await host.disposition(live.runId)).toBe("interrupted");
  });

  it("pauses and resumes with the same terminal disposition", async () => {
    const firstItem = deferred<void>();
    const host = await createHost(firstItem.promise);
    const started = await host.start(["one.mp4", "two.mp4"]);
    await host.waitUntilStarted();
    const pausePromise = host.pause();
    firstItem.resolve();
    await pausePromise;
    await host.resume();
    await host.waitForIdle();
    expect(await host.disposition(started.runId)).toBe("failed");
  });

  it("stops an in-flight run with the same terminal disposition", async () => {
    const hanging = deferred<void>();
    const host = await createHost(hanging.promise);
    const live = await host.start(["one.mp4"]);
    await host.waitUntilStarted();
    await host.stop();
    hanging.resolve();
    await host.waitForIdle();
    expect(await host.disposition(live.runId)).toBe("stopped");
  });

  it("rejects a maintenance apply that targets a live scrape path", async () => {
    const hanging = deferred<void>();
    const host = await createHost(hanging.promise);
    await host.start(["one.mp4"]);
    await host.waitUntilStarted();
    await expect(host.applyMaintenance("one.mp4")).rejects.toThrow("already being modified");
  });
});
