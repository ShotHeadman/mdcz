import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { outputFileSystem } from "./outputFileSystem";
import { WriteOutput } from "./WriteOutput";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("WriteOutput", () => {
  it("atomically replaces artifacts and supports idempotent reruns", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mdcz-write-output-"));
    directories.push(directory);
    const targetPath = path.join(directory, "movie.nfo");
    await writeFile(targetPath, "old");
    const flush = vi.fn(async (path: string) => await outputFileSystem.flush?.(path));
    const output = new WriteOutput({ ...outputFileSystem, flush });
    await output.install([{ targetPath, data: "new" }], { commit: () => undefined });
    await expect(readFile(targetPath, "utf8")).resolves.toBe("new");
    await output.install([{ targetPath, data: "new" }], { commit: () => undefined });
    await expect(readFile(targetPath, "utf8")).resolves.toBe("new");
    expect(flush).not.toHaveBeenCalled();
    const oldPoster = path.join(directory, "old-poster.jpg");
    const newPoster = path.join(directory, "new-poster.jpg");
    await writeFile(oldPoster, "poster");
    await output.install(
      [{ targetPath: newPoster, sourcePath: oldPoster, size: 6, removeSourcesAfterCommit: [oldPoster] }],
      { commit: () => undefined },
    );
    await expect(readFile(newPoster, "utf8")).resolves.toBe("poster");
    await expect(readFile(oldPoster)).rejects.toMatchObject({ code: "ENOENT" });
    expect(flush).toHaveBeenCalledOnce();
    for (const multipleTargets of [false, true]) {
      const stagingPath = path.join(directory, ".mdcz-staging-poster.part");
      const secondPoster = path.join(directory, "second", "poster.jpg");
      await writeFile(stagingPath, "downloaded");
      const copyFile = vi.fn(outputFileSystem.copyFile);
      const rename = vi.fn(outputFileSystem.rename);
      await new WriteOutput({ ...outputFileSystem, copyFile, rename }).install(
        [
          { targetPath: newPoster, sourcePath: stagingPath, size: 10, consume: true },
          ...(multipleTargets ? [{ targetPath: secondPoster, sourcePath: stagingPath, size: 10, consume: true }] : []),
        ],
        { commit: () => undefined },
      );
      expect(copyFile).toHaveBeenCalledTimes(multipleTargets ? 1 : 0);
      expect(rename).toHaveBeenCalledTimes(multipleTargets ? 2 : 1);
      expect(rename).toHaveBeenCalledWith(stagingPath, multipleTargets ? secondPoster : newPoster);
      await expect(readFile(stagingPath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(newPoster, "utf8")).resolves.toBe("downloaded");
      if (multipleTargets) await expect(readFile(secondPoster, "utf8")).resolves.toBe("downloaded");
    }
  });

  it("cleans up staged part files on failure without durable backups", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mdcz-write-output-"));
    directories.push(directory);
    const targetPath = path.join(directory, "movie.nfo");
    const failingTarget = path.join(directory, "poster.jpg");
    const output = new WriteOutput({
      ...outputFileSystem,
      rename: async (source, target) => {
        if (target === failingTarget) throw new Error("rename failed");
        await outputFileSystem.rename(source, target);
      },
    });

    await expect(
      output.install(
        [
          { targetPath, data: "nfo" },
          { targetPath: failingTarget, data: "poster" },
        ],
        { commit: () => undefined },
      ),
    ).rejects.toThrow("rename failed");

    const files = await readdir(directory);
    expect(files.some((file) => file.endsWith(".part"))).toBe(false);
    expect(files.some((file) => file.endsWith(".backup"))).toBe(false);
    await expect(readFile(targetPath, "utf8")).resolves.toBe("nfo");

    const stagingPath = path.join(directory, ".mdcz-staging-poster.part");
    await writeFile(stagingPath, "poster");
    const copyFile = vi.fn(outputFileSystem.copyFile);
    const commit = vi.fn();
    await expect(
      new WriteOutput({
        ...outputFileSystem,
        copyFile,
        rename: async () => {
          throw Object.assign(new Error("cross device staging"), { code: "EXDEV" });
        },
      }).install([{ targetPath: failingTarget, sourcePath: stagingPath, size: 6, consume: true }], { commit }),
    ).rejects.toMatchObject({ code: "EXDEV" });
    expect(copyFile).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
    await expect(readFile(stagingPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects artifact targets that overwrite source media", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mdcz-write-output-"));
    directories.push(directory);
    const targetPath = path.join(directory, "movie.nfo");
    await expect(
      new WriteOutput().install([{ targetPath, data: "new" }], {
        protectedMediaFiles: [targetPath],
        commit: () => undefined,
      }),
    ).rejects.toThrow("cannot overwrite a source media file");
    const stagingPath = path.join(directory, ".mdcz-staging-poster.part");
    await writeFile(stagingPath, "poster");
    await expect(
      new WriteOutput().install([{ targetPath, sourcePath: stagingPath, size: 6, consume: true }], {
        commit: () => undefined,
        protectedMediaFiles: [stagingPath],
      }),
    ).rejects.toThrow("Cannot consume a media file");
    await expect(readFile(stagingPath, "utf8")).resolves.toBe("poster");
  });
});
