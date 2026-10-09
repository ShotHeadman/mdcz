import { lstat, mkdtemp, readdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
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
      expect(rename).toHaveBeenCalledWith(stagingPath, multipleTargets ? secondPoster : newPoster);
      await expect(readFile(stagingPath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(newPoster, "utf8")).resolves.toBe("downloaded");
      if (multipleTargets) await expect(readFile(secondPoster, "utf8")).resolves.toBe("downloaded");
    }
    expect((await readdir(directory, { recursive: true })).some((name) => name.includes(".mdcz-"))).toBe(false);
  });

  it("restores replaced artifacts and removes new ones when installation or commit fails", async () => {
    for (const failure of ["install", "commit", "cross-device"] as const) {
      const directory = await mkdtemp(path.join(tmpdir(), "mdcz-write-output-"));
      directories.push(directory);
      const nfo = path.join(directory, "movie.nfo");
      const poster = path.join(directory, "poster.jpg");
      const fanart = path.join(directory, "fanart.jpg");
      const thumb = path.join(directory, "thumb.jpg");
      const staging = path.join(directory, ".mdcz-staging-thumb.part");
      const oldSource = path.join(directory, "old-thumb.jpg");
      await writeFile(nfo, "old nfo");
      await writeFile(poster, "old poster");
      await symlink(poster, fanart, "file");
      await writeFile(oldSource, "old thumb");
      const originalNames = (await readdir(directory)).sort();
      const originals = await Promise.all(
        [nfo, poster, fanart, oldSource].map(async (target) => {
          const { ino, size, mtimeMs } = await lstat(target);
          return { target, ino, size, mtimeMs };
        }),
      );
      await writeFile(staging, "new thumb");
      const commit = vi.fn(async () => {
        expect(await readFile(nfo, "utf8")).toBe("new nfo");
        expect(await readFile(poster, "utf8")).toBe("new poster");
        expect(await readlink(fanart)).toBe(nfo);
        expect(await readFile(thumb, "utf8")).toBe("new thumb");
        throw new Error("commit failed");
      });
      const output = new WriteOutput({
        ...outputFileSystem,
        rename: async (source, target) => {
          if (failure === "install" && source.endsWith(".part") && target === poster) throw new Error("rename failed");
          if (failure === "cross-device" && source === staging && target === thumb)
            throw Object.assign(new Error("cross device staging"), { code: "EXDEV" });
          await outputFileSystem.rename(source, target);
        },
      });
      await expect(
        output.install(
          [
            { targetPath: nfo, data: "new nfo" },
            { targetPath: fanart, symlinkTo: nfo },
            { targetPath: thumb, sourcePath: staging, size: 9, consume: true, removeSourcesAfterCommit: [oldSource] },
            { targetPath: poster, data: "new poster" },
          ],
          { commit },
        ),
      ).rejects.toThrow(failure === "install" ? "rename failed" : "commit failed");
      expect(commit).toHaveBeenCalledTimes(failure === "install" ? 0 : 1);
      expect(await readFile(nfo, "utf8")).toBe("old nfo");
      expect(await readFile(poster, "utf8")).toBe("old poster");
      expect(await readlink(fanart)).toBe(poster);
      expect(await readFile(oldSource, "utf8")).toBe("old thumb");
      for (const { target, ...facts } of originals) expect(await lstat(target)).toMatchObject(facts);
      expect((await readdir(directory)).sort()).toEqual(originalNames);
    }

    const directory = await mkdtemp(path.join(tmpdir(), "mdcz-write-output-"));
    directories.push(directory);
    const failingTarget = path.join(directory, "poster.jpg");
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
    expect(await readdir(directory)).toEqual([]);
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
