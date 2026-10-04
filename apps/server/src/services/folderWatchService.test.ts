import { appendFile, mkdir, mkdtemp, rename, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { filesystemPathKey, walkFiles } from "@mdcz/media-store";
import { FolderWatchRepository } from "@mdcz/persistence";
import { createTestPersistenceDatabase } from "@mdcz/persistence/test";
import { defaultConfiguration } from "@mdcz/shared/config";
import { describe, expect, it, vi } from "vitest";
import type { ServerConfigService } from "./configService";
import { FolderWatchService } from "./folderWatchService";

vi.mock("@mdcz/media-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mdcz/media-store")>();
  return { ...actual, walkFiles: vi.fn(actual.walkFiles) };
});

describe("FolderWatchService", () => {
  it("baselines existing media and submits stable unowned arrivals across its lifecycle", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mdcz-watch-"));
    const mediaPath = path.join(directory, "media");
    await mkdir(mediaPath);
    const configuration = structuredClone(defaultConfiguration);
    configuration.paths.mediaPath = mediaPath;
    configuration.paths.successOutputFolder = "output";
    configuration.scrape.minVideoSizeMb = 0;
    configuration.scrape.filenameBlacklistTokens = ["ignored"];
    configuration.watch = { enabled: true, intervalMinutes: 1 };
    const root = { id: "media", hostPath: mediaPath, realPath: mediaPath };
    const ancestor = { id: "ancestor", hostPath: directory, realPath: directory };
    let listener: Parameters<ServerConfigService["onChange"]>[0] | undefined;
    const unsubscribe = vi.fn();
    const scrape = { start: vi.fn().mockResolvedValue({ task: { id: "task-1" } }) };
    const maintenance = { getActiveSession: vi.fn().mockResolvedValue(null) };
    const inventoryOwnership = vi.fn().mockReturnValue([]);
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const database = createTestPersistenceDatabase();
    let releaseBaseline!: () => void;
    const baseline = new Promise<void>((resolve) => {
      releaseBaseline = resolve;
    });
    const registerPathIntent = vi
      .fn()
      .mockResolvedValue(root)
      .mockImplementationOnce(async () => {
        await baseline;
        return root;
      });
    const watcher = new FolderWatchService(
      {
        get: async () => configuration,
        onChange: (next) => {
          listener = next;
          return unsubscribe;
        },
      },
      {
        registerPathIntent,
        listRoots: async () => [root, ancestor],
        rootIntegrityGuard: () => async () => {},
        prepareOutputDirectory: async () => ({ id: "media", relativeDirectory: "output" }),
      } as never,
      scrape,
      maintenance,
      {
        getState: async () => ({
          repositories: { library: { inventoryOwnership }, folderWatch: new FolderWatchRepository(database) },
        }),
      } as never,
      logger,
    );
    const settled = () => vi.waitFor(() => expect(vi.getTimerCount()).toBe(configuration.watch.enabled ? 1 : 0));
    const cycle = async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      await settled();
    };
    const changed = async () => {
      listener?.({ configuration } as never);
      await settled();
    };
    vi.useFakeTimers();
    try {
      await writeFile(path.join(mediaPath, "existing.mp4"), "baseline");
      let started = false;
      const starting = watcher.start().then(() => {
        started = true;
      });
      await vi.advanceTimersByTimeAsync(11_000);
      expect(started).toBe(true);
      expect(registerPathIntent).toHaveBeenCalledTimes(1);
      releaseBaseline();
      await starting;
      await settled();
      expect(scrape.start).not.toHaveBeenCalled();
      await mkdir(path.join(mediaPath, "output"));
      await writeFile(path.join(mediaPath, "output", "finished.mp4"), "excluded output");
      await writeFile(path.join(mediaPath, "ignored.mp4"), "blacklisted");
      await writeFile(path.join(mediaPath, "new.mp4"), "first chunk");
      await cycle();
      expect(scrape.start).not.toHaveBeenCalled();
      await appendFile(path.join(mediaPath, "new.mp4"), "second chunk");
      await cycle();
      expect(scrape.start).not.toHaveBeenCalled();
      await cycle();
      expect(scrape.start).toHaveBeenCalledExactlyOnceWith({
        executionMode: "batch",
        refs: [{ rootId: "media", relativePath: "new.mp4" }],
        outputRootId: "media",
        outputRelativeDirectory: "output",
      });
      await cycle();
      expect(scrape.start).toHaveBeenCalledTimes(1);

      await rename(path.join(mediaPath, "new.mp4"), path.join(mediaPath, "renamed.mp4"));
      inventoryOwnership.mockReturnValue([{ rootId: "ancestor", relativePath: "media/renamed.mp4" }]);
      await cycle();
      await cycle();
      expect(inventoryOwnership).toHaveBeenLastCalledWith([{ rootId: "media", relativePath: "renamed.mp4" }]);
      expect(scrape.start).toHaveBeenCalledTimes(1);
      inventoryOwnership.mockReturnValue([]);

      await writeFile(path.join(mediaPath, "delayed.mp4"), "ready");
      await cycle();
      maintenance.getActiveSession.mockResolvedValue({ id: "maintenance", phase: "apply", status: "running" });
      await cycle();
      expect(scrape.start).toHaveBeenCalledTimes(1);
      maintenance.getActiveSession.mockResolvedValue({ id: "maintenance", phase: "apply", status: "completed" });
      scrape.start.mockRejectedValueOnce(new Error("queue unavailable"));
      await cycle();
      expect(scrape.start).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenLastCalledWith(expect.stringContaining("queue unavailable"));
      await cycle();
      await cycle();
      expect(scrape.start).toHaveBeenCalledTimes(3);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("taskId=task-1"));

      await writeFile(path.join(mediaPath, "vanishing.mp4"), "temporary");
      await cycle();
      await rm(path.join(mediaPath, "vanishing.mp4"));
      await cycle();
      await writeFile(path.join(mediaPath, "vanishing.mp4"), "temporary");
      await cycle();
      expect(scrape.start).toHaveBeenCalledTimes(3);
      await cycle();
      expect(scrape.start).toHaveBeenCalledTimes(4);

      await writeFile(path.join(mediaPath, "settings-change.mp4"), "arrived before changes");
      for (const change of [
        () => {
          configuration.paths.successOutputFolder = "new-output";
        },
        () => {
          configuration.paths.defaultScanExcludeDirs = ["excluded"];
        },
        () => {
          configuration.paths.defaultScanExcludeDirs = [];
        },
        () => {
          configuration.scrape.filenameBlacklistTokens = [];
        },
        () => {
          configuration.scrape.minVideoSizeMb = 1;
        },
        () => {
          configuration.scrape.minVideoSizeMb = 0;
        },
        () => {
          configuration.behavior.metadataOnly = true;
        },
        () => {
          configuration.paths.metadataPath = "metadata";
        },
      ]) {
        change();
        await changed();
      }
      inventoryOwnership.mockImplementation((refs: Array<{ relativePath: string }>) =>
        refs.filter(({ relativePath }) => relativePath.endsWith("finished.mp4")),
      );
      await cycle();
      await cycle();
      expect(scrape.start).toHaveBeenCalledTimes(5);
      expect(scrape.start.mock.lastCall?.[0].refs).toHaveLength(2);
      expect(scrape.start).toHaveBeenLastCalledWith(
        expect.objectContaining({
          refs: expect.arrayContaining([
            { rootId: "media", relativePath: "ignored.mp4" },
            { rootId: "media", relativePath: "settings-change.mp4" },
          ]),
        }),
      );
      inventoryOwnership.mockReturnValue([]);

      const actual = await vi.importActual<typeof import("@mdcz/media-store")>("@mdcz/media-store");
      let hidden: string[] = [];
      vi.mocked(walkFiles).mockImplementation(async (root, recursive, signal, options) => {
        if (!options?.warnings) throw new Error("Missing warning collector");
        options.warnings.count += 1;
        options.warnings.paths.push(path.join(mediaPath, "inaccessible"));
        return await actual.walkFiles(root, recursive, signal, {
          ...options,
          onFile: (file, stats) => {
            if (!hidden.includes(path.basename(file))) options.onFile?.(file, stats);
          },
        });
      });
      logger.error.mockClear();
      await writeFile(path.join(mediaPath, "warning-arrival.mp4"), "ready");
      await cycle();
      hidden = ["existing.mp4", "warning-arrival.mp4"];
      await cycle();
      hidden = [];
      await cycle();
      expect(scrape.start).toHaveBeenCalledTimes(5);
      await cycle();
      expect(scrape.start).toHaveBeenCalledTimes(6);
      expect(scrape.start.mock.calls.at(-1)?.[0].refs).toEqual([
        { rootId: "media", relativePath: "warning-arrival.mp4" },
      ]);
      expect(logger.error).not.toHaveBeenCalled();

      configuration.watch.enabled = false;
      await changed();
      await writeFile(path.join(mediaPath, "while-disabled.mp4"), "arrived while disabled");
      await cycle();
      configuration.watch.enabled = true;
      await changed();
      await cycle();
      expect(scrape.start).toHaveBeenCalledTimes(7);
      expect(scrape.start.mock.calls.at(-1)?.[0].refs).toEqual([
        { rootId: "media", relativePath: "while-disabled.mp4" },
      ]);

      const nested = path.join(mediaPath, "release", "nested.mp4");
      await mkdir(path.dirname(nested));
      await writeFile(nested, "ready");
      await cycle();
      await cycle();
      await rm(path.dirname(nested), { recursive: true });
      await cycle();
      await mkdir(path.dirname(nested));
      await writeFile(nested, "ready again");
      await cycle();
      await cycle();
      expect(scrape.start).toHaveBeenCalledTimes(9);

      let release!: () => void;
      maintenance.getActiveSession.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve(null);
          }),
      );
      await writeFile(path.join(mediaPath, "shutdown.mp4"), "ready");
      await cycle();
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.waitFor(() => expect(release).toBeTypeOf("function"));
      const calls = maintenance.getActiveSession.mock.calls.length;
      await vi.advanceTimersByTimeAsync(180_000);
      expect(maintenance.getActiveSession).toHaveBeenCalledTimes(calls);
      const closing = watcher.close();
      release();
      await closing;
      await vi.advanceTimersByTimeAsync(180_000);
      expect(scrape.start).toHaveBeenCalledTimes(9);
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      releaseBaseline();
      await watcher.close();
      vi.useRealTimers();
      vi.mocked(walkFiles).mockRestore();
      database.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("resumes the persisted snapshot after a restart and rebuilds it for a new media directory", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mdcz-watch-"));
    const roots = ["media", "other"].map((id) => ({
      id,
      hostPath: path.join(directory, id),
      realPath: path.join(directory, id),
    }));
    for (const root of roots) await mkdir(root.hostPath);
    const [media, other] = roots;
    const configuration = structuredClone(defaultConfiguration);
    configuration.paths.mediaPath = media.hostPath;
    configuration.scrape.minVideoSizeMb = 0;
    configuration.watch = { enabled: true, intervalMinutes: 1 };
    const database = createTestPersistenceDatabase();
    const folderWatch = new FolderWatchRepository(database);
    const scrape = { start: vi.fn().mockResolvedValue({ task: { id: "task" } }) };
    let listener: Parameters<ServerConfigService["onChange"]>[0] | undefined;
    const createWatcher = () =>
      new FolderWatchService(
        {
          get: async () => configuration,
          onChange: (next) => {
            listener = next;
            return () => {};
          },
        },
        {
          registerPathIntent: async (hostPath: string) => roots.find((root) => root.hostPath === hostPath),
          listRoots: async () => roots,
          rootIntegrityGuard: () => async () => {},
          prepareOutputDirectory: async () => ({ id: "media", relativeDirectory: "output" }),
        } as never,
        scrape,
        { getActiveSession: async () => null },
        {
          getState: async () => ({
            repositories: { library: { inventoryOwnership: () => [] }, folderWatch },
          }),
        } as never,
        { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      );
    const settled = () => vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
    const cycle = async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      await settled();
    };
    vi.useFakeTimers();
    let watcher = createWatcher();
    try {
      await writeFile(path.join(media.hostPath, "existing.mp4"), "baseline");
      await watcher.start();
      await settled();
      await watcher.close();

      // Cloud drive transfers keep the original modification time, so offline arrivals must not be judged by it.
      await writeFile(path.join(media.hostPath, "offline.mp4"), "arrived while stopped");
      await utimes(path.join(media.hostPath, "offline.mp4"), new Date("2020-01-01"), new Date("2020-01-01"));
      watcher = createWatcher();
      await watcher.start();
      await settled();
      await cycle();
      expect(scrape.start).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ refs: [{ rootId: "media", relativePath: "offline.mp4" }] }),
      );

      await writeFile(path.join(other.hostPath, "other-existing.mp4"), "baseline");
      configuration.paths.mediaPath = other.hostPath;
      listener?.({ configuration } as never);
      await settled();
      await cycle();
      await cycle();
      expect(scrape.start).toHaveBeenCalledTimes(1);
      expect(folderWatch.load(filesystemPathKey(media.hostPath))).toBeUndefined();
    } finally {
      await watcher.close();
      vi.useRealTimers();
      database.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
