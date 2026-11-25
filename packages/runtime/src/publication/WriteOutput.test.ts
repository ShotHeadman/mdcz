import { lstat, mkdtemp, readdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSymlinkSupport, outputFileSystem } from "./outputFileSystem";
import { type PublicationJournalEntry, publicationJournal } from "./publicationJournal";
import { publicationPolicy } from "./publicationPolicy";
import { recoverInterruptedPublications } from "./recoverInterruptedPublications";
import { WriteOutput } from "./WriteOutput";

const directories: string[] = [];

afterEach(async () => {
  publicationPolicy.reset();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

// Unelevated Windows cannot create symlinks.
const symlinksSupported = await assertSymlinkSupport(tmpdir()).then(
  () => true,
  () => false,
);

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

  it.skipIf(!symlinksSupported)(
    "restores replaced artifacts and removes new ones when installation or commit fails",
    async () => {
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
            if (failure === "install" && source.endsWith(".part") && target === poster)
              throw new Error("rename failed");
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
    },
  );

  it("writes targets under their final names when direct, renaming no file it has created", async () => {
    const journal = new Map<string, PublicationJournalEntry>();
    publicationJournal.attach({
      record: (entry) => void journal.set(entry.path, entry),
      forget: (entryPath) => void journal.delete(entryPath),
      list: () => [...journal.values()],
    });
    for (const failure of [undefined, "write", "commit"] as const) {
      const library = await mkdtemp(path.join(tmpdir(), "mdcz-write-output-"));
      const staging = await mkdtemp(path.join(tmpdir(), "mdcz-write-staging-"));
      directories.push(library, staging);
      const nfo = path.join(library, "movie.nfo");
      const poster = path.join(library, "poster.jpg");
      const thumb = path.join(library, "extra", "thumb.jpg");
      const downloaded = path.join(staging, "poster.jpg");
      await writeFile(nfo, "old nfo");
      await writeFile(poster, "old poster");
      await writeFile(downloaded, "new poster");
      const original = new Set([nfo, poster]);
      const rename = vi.fn(outputFileSystem.rename);
      const copyFile = vi.fn(async () => {
        throw Object.assign(new Error("copyfile refused"), { code: "EIO" });
      });
      const install = new WriteOutput({
        ...outputFileSystem,
        rename,
        copyFile,
        writeFile: async (target, data, options) => {
          if (failure === "write" && target === thumb) {
            await outputFileSystem.writeFile(target, "tr");
            throw Object.assign(new Error("i/o error"), { code: "EIO" });
          }
          await outputFileSystem.writeFile(target, data, options);
        },
      }).install(
        [
          { targetPath: nfo, data: "new nfo" },
          { targetPath: poster, sourcePath: downloaded, size: 10, consume: true },
          { targetPath: thumb, data: "new thumb" },
        ],
        {
          direct: true,
          commit: () => {
            if (failure === "commit") throw new Error("commit failed");
          },
        },
      );
      if (failure) await expect(install).rejects.toThrow(failure === "write" ? "i/o error" : "commit failed");
      else await install;

      await expect(readFile(nfo, "utf8")).resolves.toBe(failure ? "old nfo" : "new nfo");
      await expect(readFile(poster, "utf8")).resolves.toBe(failure ? "old poster" : "new poster");
      if (failure) expect(await readdir(library)).toEqual(["movie.nfo", "poster.jpg"]);
      else await expect(readFile(thumb, "utf8")).resolves.toBe("new thumb");
      expect((await readdir(library, { recursive: true })).some((name) => name.includes(".mdcz-"))).toBe(false);
      expect(await readdir(staging)).toEqual([]);
      // Cloud mounts refuse the kernel's copy of a fresh file, so a direct write copies bytes itself.
      expect(copyFile).not.toHaveBeenCalled();
      // Only files that were there before the publication are ever renamed: aside, and back when it fails.
      expect(rename.mock.calls.length).toBe(failure ? 4 : 2);
      for (const [source] of rename.mock.calls)
        expect(original.has(source) || source.includes(".mdcz-backup-")).toBe(true);
      expect(journal.size).toBe(0);
    }

    // When a cloud mount is not detected up front, EIO on a fresh-file rename falls back to direct write, reuses the
    // staged bytes instead of re-reading the source, and latches the root.
    const undetected = await mkdtemp(path.join(tmpdir(), "mdcz-write-eio-"));
    const undetectedSourceDir = await mkdtemp(path.join(tmpdir(), "mdcz-write-eio-src-"));
    directories.push(undetected, undetectedSourceDir);
    const eioNfo = path.join(undetected, "movie.nfo");
    const eioPoster = path.join(undetected, "poster.jpg");
    const eioSource = path.join(undetectedSourceDir, "source.jpg");
    await writeFile(eioNfo, "old nfo");
    await writeFile(eioSource, "staged-img");
    const logger = { warn: vi.fn() };
    const eioRename = vi.fn(async (source: string, target: string) => {
      if (source.endsWith(".part")) {
        await writeFile(eioSource, "mutated-im");
        throw Object.assign(new Error("i/o error"), { code: "EIO" });
      }
      await outputFileSystem.rename(source, target);
    });
    await new WriteOutput({ ...outputFileSystem, rename: eioRename }, logger).install(
      [
        { targetPath: eioPoster, sourcePath: eioSource, size: 10 },
        { targetPath: eioNfo, data: "new nfo" },
      ],
      { commit: () => undefined },
    );
    await expect(readFile(eioPoster, "utf8")).resolves.toBe("staged-img");
    await expect(readFile(eioNfo, "utf8")).resolves.toBe("new nfo");
    expect((await readdir(undetected)).sort()).toEqual(["movie.nfo", "poster.jpg"]);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(await publicationPolicy.isDirectWrite(path.join(undetected, "fanart.jpg"))).toBe(true);

    // Direct write aborts instead of overwriting when backing up an existing file returns EIO.
    const backupFailDir = await mkdtemp(path.join(tmpdir(), "mdcz-write-backup-eio-"));
    directories.push(backupFailDir);
    const protectedNfo = path.join(backupFailDir, "movie.nfo");
    await writeFile(protectedNfo, "original nfo");
    await expect(
      new WriteOutput({
        ...outputFileSystem,
        rename: async () => {
          throw Object.assign(new Error("backup rename refused"), { code: "EIO" });
        },
      }).install([{ targetPath: protectedNfo, data: "new nfo" }], {
        direct: true,
        commit: () => undefined,
      }),
    ).rejects.toMatchObject({ code: "EIO" });
    await expect(readFile(protectedNfo, "utf8")).resolves.toBe("original nfo");
    expect(await readdir(backupFailDir)).toEqual(["movie.nfo"]);
    expect(journal.size).toBe(0);

    // If commit fails and rollback rename also fails with EIO, startup recovery deletes the uncommitted target and
    // restores the original backup rather than deleting the backup.
    const rollbackFailDir = await mkdtemp(path.join(tmpdir(), "mdcz-write-rollback-eio-"));
    directories.push(rollbackFailDir);
    const rollbackNfo = path.join(rollbackFailDir, "movie.nfo");
    await writeFile(rollbackNfo, "original nfo");
    const rollbackLogger = { warn: vi.fn() };
    await expect(
      new WriteOutput(
        {
          ...outputFileSystem,
          rename: async (source, target) => {
            if (source.includes(".mdcz-backup-")) throw Object.assign(new Error("restore refused"), { code: "EIO" });
            await outputFileSystem.rename(source, target);
          },
        },
        rollbackLogger,
      ).install([{ targetPath: rollbackNfo, data: "uncommitted nfo" }], {
        direct: true,
        commit: () => {
          throw new Error("commit failed");
        },
      }),
    ).rejects.toThrow("commit failed");
    await recoverInterruptedPublications(
      {
        record: (entry) => void journal.set(entry.path, entry),
        forget: (entryPath) => void journal.delete(entryPath),
        list: () => [...journal.values()],
      },
      rollbackLogger,
    );
    await expect(readFile(rollbackNfo, "utf8")).resolves.toBe("original nfo");
    expect(await readdir(rollbackFailDir)).toEqual(["movie.nfo"]);
    expect(journal.size).toBe(0);

    // If a failed direct write leaves a backup after rollback EIO, a subsequent successful retry cleans up the stale
    // backup so a later restart does not overwrite the newly committed file with the older backup.
    const retryDir = await mkdtemp(path.join(tmpdir(), "mdcz-write-retry-"));
    directories.push(retryDir);
    const retryNfo = path.join(retryDir, "movie.nfo");
    await writeFile(retryNfo, "v1 nfo");
    await expect(
      new WriteOutput(
        {
          ...outputFileSystem,
          rename: async (source, target) => {
            if (source.includes(".mdcz-backup-")) throw Object.assign(new Error("restore refused"), { code: "EIO" });
            await outputFileSystem.rename(source, target);
          },
        },
        { warn: vi.fn() },
      ).install([{ targetPath: retryNfo, data: "failed v2" }], {
        direct: true,
        commit: () => {
          throw new Error("commit failed");
        },
      }),
    ).rejects.toThrow("commit failed");
    await new WriteOutput().install([{ targetPath: retryNfo, data: "committed v3" }], {
      direct: true,
      commit: () => undefined,
    });
    await recoverInterruptedPublications({
      record: (entry) => void journal.set(entry.path, entry),
      forget: (entryPath) => void journal.delete(entryPath),
      list: () => [...journal.values()],
    });
    await expect(readFile(retryNfo, "utf8")).resolves.toBe("committed v3");
    expect(await readdir(retryDir)).toEqual(["movie.nfo"]);
    expect(journal.size).toBe(0);

    // Mixed batches decide direct vs atomic mode per target directory regardless of artifact order.
    const localDir = await mkdtemp(path.join(tmpdir(), "mdcz-write-mixed-local-"));
    const cloudDir = await mkdtemp(path.join(tmpdir(), "mdcz-write-mixed-cloud-"));
    directories.push(localDir, cloudDir);
    publicationPolicy.configure({
      resolveTarget: (targetPath) => ({
        directWrite: path.resolve(targetPath).startsWith(path.resolve(cloudDir)),
      }),
    });
    for (const cloudFirst of [true, false]) {
      const localTarget = path.join(localDir, `${cloudFirst ? "a" : "b"}.nfo`);
      const cloudTarget = path.join(cloudDir, `${cloudFirst ? "a" : "b"}.jpg`);
      const renames: Array<[string, string]> = [];
      const mixedArtifacts = cloudFirst
        ? [
            { targetPath: cloudTarget, data: "cloud" },
            { targetPath: localTarget, data: "local" },
          ]
        : [
            { targetPath: localTarget, data: "local" },
            { targetPath: cloudTarget, data: "cloud" },
          ];
      await new WriteOutput({
        ...outputFileSystem,
        rename: async (source, target) => {
          renames.push([source, target]);
          await outputFileSystem.rename(source, target);
        },
      }).install(mixedArtifacts, { commit: () => undefined });
      expect(renames).toEqual([[expect.stringContaining(".mdcz-staging-"), localTarget]]);
      await expect(readFile(localTarget, "utf8")).resolves.toBe("local");
      await expect(readFile(cloudTarget, "utf8")).resolves.toBe("cloud");
    }
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
