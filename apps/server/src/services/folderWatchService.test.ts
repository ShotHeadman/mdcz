import { appendFile, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { walkFiles } from "@mdcz/media-store";
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
      { getState: async () => ({ repositories: { library: { inventoryOwnership } } }) } as never,
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
        await writeFile(path.join(mediaPath, "settings-change.mp4"), "existing before change");
        change();
        await changed();
        await cycle();
        await cycle();
        expect(scrape.start).toHaveBeenCalledTimes(4);
      }

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
      expect(scrape.start).toHaveBeenCalledTimes(4);
      await cycle();
      expect(scrape.start).toHaveBeenCalledTimes(5);
      expect(scrape.start.mock.calls.at(-1)?.[0].refs).toEqual([
        { rootId: "media", relativePath: "warning-arrival.mp4" },
      ]);
      expect(logger.error).not.toHaveBeenCalled();

      configuration.watch.enabled = false;
      await changed();
      await writeFile(path.join(mediaPath, "while-disabled.mp4"), "baseline again");
      await cycle();
      configuration.watch.enabled = true;
      await changed();
      await cycle();
      expect(scrape.start).toHaveBeenCalledTimes(5);

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
      expect(scrape.start).toHaveBeenCalledTimes(5);
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      releaseBaseline();
      await watcher.close();
      vi.useRealTimers();
      vi.mocked(walkFiles).mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
