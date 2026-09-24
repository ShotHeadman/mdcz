import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MoveOutput } from "./MoveOutput";
import { outputFileSystem } from "./outputFileSystem";

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  readlink: vi.fn(),
}));

const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(fs.readlink).mockReset();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const fixture = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "mdcz-move-output-"));
  directories.push(directory);
  const sourcePath = path.join(directory, "source.mp4");
  const targetPath = path.join(directory, "library", "target.mp4");
  await writeFile(sourcePath, "video");
  const observed = await fs.stat(sourcePath);
  return {
    directory,
    sourcePath,
    targetPath,
    move: {
      source: { rootId: "root", relativePath: "source.mp4" },
      target: { rootId: "root", relativePath: "library/target.mp4" },
      sourcePath,
      targetPath,
      dev: observed.dev,
      ino: observed.ino,
      size: observed.size,
      mtimeMs: observed.mtimeMs,
    },
  };
};

describe("MoveOutput", () => {
  it("restores uncommitted media when the database commit fails", async () => {
    const test = await fixture();
    const nfoPath = path.join(path.dirname(test.targetPath), "movie.nfo");
    await expect(
      new MoveOutput().install({
        moves: [test.move],
        artifacts: [{ targetPath: nfoPath, data: "nfo" }],
        commit: () => {
          expect(existsSync(test.targetPath)).toBe(true);
          throw new Error("commit failed");
        },
      }),
    ).rejects.toThrow("commit failed");
    await expect(readFile(test.sourcePath, "utf8")).resolves.toBe("video");
    await expect(readFile(test.targetPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(nfoPath, "utf8")).resolves.toBe("nfo");

    const rewritten = await fixture();
    await expect(
      new MoveOutput().install({
        moves: [{ ...rewritten.move, rewrittenContent: "rewritten" }],
        artifacts: [],
        commit: () => {
          throw new Error("commit failed");
        },
      }),
    ).rejects.toThrow("commit failed");
    await expect(readFile(rewritten.sourcePath, "utf8")).resolves.toBe("video");
    await expect(readFile(rewritten.targetPath)).rejects.toMatchObject({ code: "ENOENT" });

    const crossDevice = await fixture();
    await expect(
      new MoveOutput({
        ...outputFileSystem,
        rename: async (source, target) => {
          if (source === crossDevice.sourcePath) throw Object.assign(new Error("cross device"), { code: "EXDEV" });
          await fs.rename(source, target);
        },
      }).install({
        moves: [crossDevice.move],
        artifacts: [],
        commit: () => {
          throw new Error("commit failed");
        },
      }),
    ).rejects.toThrow("commit failed");
    await expect(readFile(crossDevice.sourcePath, "utf8")).resolves.toBe("video");
    await expect(readFile(crossDevice.targetPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the cross-device source through commit and deletes it afterward", async () => {
    const test = await fixture();
    const rename = vi.fn(async (source: string, target: string) => {
      if (source === test.sourcePath) throw Object.assign(new Error("cross device"), { code: "EXDEV" });
      await fs.rename(source, target);
    });
    const commit = vi.fn(() => {
      expect(existsSync(test.sourcePath)).toBe(true);
      return "committed";
    });
    const result = await new MoveOutput({ ...outputFileSystem, rename }).install({
      moves: [test.move],
      artifacts: [],
      commit,
    });
    expect(result).toBe("committed");
    expect(commit).toHaveBeenCalledOnce();
    await expect(readFile(test.targetPath, "utf8")).resolves.toBe("video");
    await expect(readFile(test.sourcePath)).rejects.toMatchObject({ code: "ENOENT" });

    const failedCleanup = await fixture();
    const logger = { warn: vi.fn() };
    const failedRename = vi.fn(async (source: string, target: string) => {
      if (source === failedCleanup.sourcePath) throw Object.assign(new Error("cross device"), { code: "EXDEV" });
      await fs.rename(source, target);
    });
    const remove: typeof outputFileSystem.rm = async (target, options) => {
      if (target === failedCleanup.sourcePath) throw new Error("source is locked");
      await fs.rm(target, options);
    };
    await new MoveOutput({ ...outputFileSystem, rename: failedRename, rm: remove }, logger).install({
      moves: [failedCleanup.move],
      artifacts: [],
      commit: () => "committed",
    });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("source is locked"));
    await expect(readFile(failedCleanup.sourcePath, "utf8")).resolves.toBe("video");
    await expect(readFile(failedCleanup.targetPath, "utf8")).resolves.toBe("video");

    const multipart = await fixture();
    const secondSource = path.join(multipart.directory, "second.mp4");
    const secondTarget = path.join(path.dirname(multipart.targetPath), "second.mp4");
    await writeFile(secondSource, "second");
    const secondFacts = await fs.stat(secondSource);
    const readdir = vi.fn(outputFileSystem.readdir);
    await new MoveOutput({
      ...outputFileSystem,
      readdir,
      rename: async (source, target) => {
        if (source === multipart.sourcePath || source === secondSource)
          throw Object.assign(new Error("cross device"), { code: "EXDEV" });
        await fs.rename(source, target);
      },
    }).install({
      moves: [
        multipart.move,
        {
          ...multipart.move,
          sourcePath: secondSource,
          targetPath: secondTarget,
          source: { rootId: "root", relativePath: "second.mp4" },
          target: { rootId: "root", relativePath: "library/second.mp4" },
          dev: secondFacts.dev,
          ino: secondFacts.ino,
          size: secondFacts.size,
          mtimeMs: secondFacts.mtimeMs,
        },
      ],
      artifacts: [],
      commit: () => undefined,
    });
    expect(readdir).toHaveBeenCalledOnce();
    await expect(readFile(secondTarget, "utf8")).resolves.toBe("second");
  });

  it("rejects occupied destinations and changes after initial observation before mutation", async () => {
    for (const transfer of ["rename", "copy", "rewrite"] as const) {
      const local = await fixture();
      const targetPath = path.join(local.directory, "source.mkv");
      const conflictPath = path.join(local.directory, "source.avi");
      const move = {
        ...local.move,
        target: { rootId: "root", relativePath: "source.mkv" },
        targetPath,
        rewrittenContent: transfer === "rewrite" ? "rewritten" : undefined,
      };
      const flush = vi.fn(async (path: string) => await outputFileSystem.flush?.(path));
      const output = new MoveOutput({
        ...outputFileSystem,
        flush,
        rename: async (source, target) => {
          if (transfer === "copy" && source === local.sourcePath)
            throw Object.assign(new Error("cross device"), { code: "EXDEV" });
          await fs.rename(source, target);
        },
      });
      const commit = vi.fn(() => "committed");
      for (const occupied of [targetPath, conflictPath]) {
        await writeFile(occupied, "existing");
        await expect(output.install({ moves: [move], artifacts: [], reorganize: true, commit })).rejects.toThrow(
          "已存在",
        );
        expect(commit).not.toHaveBeenCalled();
        await expect(readFile(local.sourcePath, "utf8")).resolves.toBe("video");
        await expect(readFile(occupied, "utf8")).resolves.toBe("existing");
        await rm(occupied);
      }
      await expect(output.install({ moves: [move], artifacts: [], reorganize: true, commit })).resolves.toBe(
        "committed",
      );
      expect(commit).toHaveBeenCalledOnce();
      expect(flush).toHaveBeenCalledTimes(transfer === "copy" ? 1 : 0);
      await expect(readFile(targetPath, "utf8")).resolves.toBe(transfer === "rewrite" ? "rewritten" : "video");
      await expect(readFile(local.sourcePath)).rejects.toMatchObject({ code: "ENOENT" });
    }
    const test = await fixture();
    await fs.mkdir(path.dirname(test.targetPath), { recursive: true });
    await writeFile(test.targetPath, "existing");
    await expect(
      new MoveOutput().install({
        moves: [test.move],
        artifacts: [],
        commit: () => undefined,
      }),
    ).rejects.toThrow("已存在");
    await expect(readFile(test.sourcePath, "utf8")).resolves.toBe("video");
    await expect(readFile(test.targetPath, "utf8")).resolves.toBe("existing");
    const overlapping = await fixture();
    await expect(
      new MoveOutput().install({
        moves: [overlapping.move],
        artifacts: [{ targetPath: overlapping.targetPath, data: "metadata" }],
        commit: () => undefined,
      }),
    ).rejects.toThrow("cannot overwrite a source media file");
    await expect(readFile(overlapping.sourcePath, "utf8")).resolves.toBe("video");
    await expect(readFile(overlapping.targetPath)).rejects.toMatchObject({ code: "ENOENT" });
    const linked = await fixture();
    const linkedStats = await fs.lstat(linked.sourcePath);
    vi.spyOn(linkedStats, "isSymbolicLink").mockReturnValue(true);
    vi.mocked(fs.readlink).mockResolvedValueOnce("raw.mp4");
    const rename = vi.fn(outputFileSystem.rename);
    const copyFile = vi.fn(outputFileSystem.copyFile);
    const commit = vi.fn();
    await expect(
      new MoveOutput({
        ...outputFileSystem,
        lstat: async (source) => (source === linked.sourcePath ? linkedStats : await outputFileSystem.lstat(source)),
        rename,
        copyFile,
      }).install({
        moves: [linked.move],
        artifacts: [],
        commit,
      }),
    ).rejects.toThrow("Cannot move a relative file symlink to another directory");
    expect(fs.readlink).toHaveBeenCalledExactlyOnceWith(linked.sourcePath);
    expect(rename).not.toHaveBeenCalled();
    expect(copyFile).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    await expect(readFile(linked.sourcePath, "utf8")).resolves.toBe("video");
    await expect(readFile(linked.targetPath)).rejects.toMatchObject({ code: "ENOENT" });
    for (const changed of ["source", "target"] as const) {
      const pending = await fixture();
      const commit = vi.fn();
      await expect(
        new MoveOutput().install({
          moves: [pending.move],
          artifacts: [{ targetPath: path.join(path.dirname(pending.targetPath), "movie.nfo"), data: "nfo" }],
          validate: async () => {
            await fs.mkdir(path.dirname(pending.targetPath), { recursive: true });
            await writeFile(
              changed === "source" ? pending.sourcePath : pending.targetPath,
              "changed after observation",
            );
          },
          commit,
        }),
      ).rejects.toThrow(changed === "source" ? "source changed before mutation" : "已存在");
      expect(commit).not.toHaveBeenCalled();
      await expect(readFile(pending.sourcePath, "utf8")).resolves.toBe(
        changed === "source" ? "changed after observation" : "video",
      );
      await expect(readFile(path.join(path.dirname(pending.targetPath), "movie.nfo"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
  });
});
