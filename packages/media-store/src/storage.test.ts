import type * as NodeFsPromises from "node:fs/promises";
import { mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { createTempDirectory, type TempDirectoryHarness } from "../../../tests/harness/tempDirectory";

const filesystemFaults = vi.hoisted(() => ({
  removeError: null as Error | null,
  renameError: null as Error | null,
}));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof NodeFsPromises>("node:fs/promises");
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (filesystemFaults.renameError) {
        const error = filesystemFaults.renameError;
        filesystemFaults.renameError = null;
        throw error;
      }
      return actual.rename(...args);
    },
    rm: async (...args: Parameters<typeof actual.rm>) => {
      if (filesystemFaults.removeError) {
        const error = filesystemFaults.removeError;
        filesystemFaults.removeError = null;
        throw error;
      }
      return actual.rm(...args);
    },
  };
});

import {
  atomicCopyFile,
  atomicWriteFile,
  atomicWriteRootFile,
  createMediaRoot,
  listRootDirectory,
  listRootFiles,
  normalizeRootRelativePath,
  readRootFile,
  resolveRootRelativePath,
  StorageError,
  statRootPath,
  storageErrorCodes,
  toRootRelativePath,
} from "./index";

const tempRoots: TempDirectoryHarness[] = [];

const createTempRoot = async () => {
  const directory = await createTempDirectory("storage");
  tempRoots.push(directory);
  return createMediaRoot({
    id: "root-1",
    displayName: "Movies",
    hostPath: directory.path,
    now: new Date("2026-04-28T00:00:00.000Z"),
  });
};

afterEach(async () => {
  filesystemFaults.removeError = null;
  filesystemFaults.renameError = null;
  await Promise.all(tempRoots.splice(0).map((directory) => directory.cleanup()));
});

describe("storage root-relative paths", () => {
  it("creates stable mounted filesystem roots", async () => {
    const directory = await createTempDirectory("storage");
    tempRoots.push(directory);

    expect(
      createMediaRoot({
        id: "root-1",
        displayName: "  Movies  ",
        hostPath: path.join(directory.path, "."),
        now: new Date("2026-04-28T00:00:00.000Z"),
      }),
    ).toEqual({
      id: "root-1",
      displayName: "Movies",
      hostPath: path.resolve(directory.path),
      createdAt: new Date("2026-04-28T00:00:00.000Z"),
      updatedAt: new Date("2026-04-28T00:00:00.000Z"),
    });
  });

  it("normalizes portable root-relative paths", () => {
    expect(normalizeRootRelativePath("folder//movie.mkv")).toBe("folder/movie.mkv");
    expect(normalizeRootRelativePath("./folder/../movie.mkv")).toBe("movie.mkv");
    expect(normalizeRootRelativePath("a/../b")).toBe("b");
  });

  it("rejects absolute and parent-relative paths", () => {
    expect(() => normalizeRootRelativePath("../movie.mkv")).toThrow(StorageError);
    expect(() => normalizeRootRelativePath("/movie.mkv")).toThrow(StorageError);
  });

  it("keeps resolved host paths inside the root", async () => {
    const root = await createTempRoot();

    expect(resolveRootRelativePath(root, "a/b.mkv")).toBe(path.join(root.hostPath, "a", "b.mkv"));
    expect(() => resolveRootRelativePath(root, "../outside.mkv")).toThrow(
      expect.objectContaining({ code: storageErrorCodes.OutsideRoot }),
    );
  });
});

describe("absolute filesystem publication", () => {
  it("writes and copies through hidden UUID temporary files in the target directory", async () => {
    const directory = await createTempDirectory("atomic-filesystem");
    tempRoots.push(directory);
    const sourcePath = path.join(directory.path, "source.bin");
    const writtenPath = path.join(directory.path, "nested", "movie.nfo");
    const copiedPath = path.join(directory.path, "copied", "movie.bin");
    await writeFile(sourcePath, new Uint8Array([1, 2, 3]));

    await atomicWriteFile(writtenPath, "metadata");
    await atomicCopyFile(sourcePath, copiedPath);

    await expect(readFile(writtenPath, "utf8")).resolves.toBe("metadata");
    await expect(readFile(copiedPath)).resolves.toEqual(Buffer.from([1, 2, 3]));
    await expect(readdir(path.dirname(writtenPath))).resolves.toEqual(["movie.nfo"]);
    await expect(readdir(path.dirname(copiedPath))).resolves.toEqual(["movie.bin"]);
  });

  it("rejects relative source and target paths before touching the filesystem", async () => {
    await expect(atomicWriteFile("relative.nfo", "metadata")).rejects.toThrow("filePath must be an absolute path");
    await expect(atomicCopyFile("relative.bin", path.resolve("target.bin"))).rejects.toThrow(
      "sourcePath must be an absolute path",
    );
    await expect(atomicCopyFile(path.resolve("source.bin"), "relative.bin")).rejects.toThrow(
      "targetPath must be an absolute path",
    );
  });

  it("keeps the old root file and removes its temporary file when publish fails", async () => {
    const root = await createTempRoot();
    const targetPath = path.join(root.hostPath, "nested", "movie.nfo");
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, "old");
    const renameError = new Error("rename failed");
    filesystemFaults.renameError = renameError;

    await expect(atomicWriteRootFile(root, "nested/movie.nfo", "new")).rejects.toBe(renameError);

    await expect(readFile(targetPath, "utf8")).resolves.toBe("old");
    await expect(readdir(path.dirname(targetPath))).resolves.toEqual(["movie.nfo"]);
  });

  it("keeps the old copy target and removes its temporary file when copying fails", async () => {
    const directory = await createTempDirectory("atomic-copy-failure");
    tempRoots.push(directory);
    const targetPath = path.join(directory.path, "movie.bin");
    await writeFile(targetPath, "old");

    await expect(atomicCopyFile(path.join(directory.path, "missing.bin"), targetPath)).rejects.toMatchObject({
      code: "ENOENT",
    });

    await expect(readFile(targetPath, "utf8")).resolves.toBe("old");
    await expect(readdir(directory.path)).resolves.toEqual(["movie.bin"]);
  });

  it("throws the publish error and attaches a temporary-file cleanup error as its cause", async () => {
    const directory = await createTempDirectory("atomic-cleanup-failure");
    tempRoots.push(directory);
    const targetPath = path.join(directory.path, "movie.nfo");
    await writeFile(targetPath, "old");
    const renameError = new Error("rename failed");
    const cleanupError = new Error("cleanup failed");
    filesystemFaults.renameError = renameError;
    filesystemFaults.removeError = cleanupError;

    await expect(atomicWriteFile(targetPath, "new")).rejects.toBe(renameError);

    expect(renameError.cause).toBe(cleanupError);
    await expect(readFile(targetPath, "utf8")).resolves.toBe("old");
    expect(await readdir(directory.path)).toEqual([
      expect.stringMatching(
        /^\.movie\.nfo\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/u,
      ),
      "movie.nfo",
    ]);
  });
});

describe("mounted filesystem helpers", () => {
  it("atomically writes, reads, lists, and converts root-relative references", async () => {
    const root = await createTempRoot();

    await atomicWriteRootFile(root, "nested/movie.nfo", "metadata");

    await expect(readRootFile(root, "nested/movie.nfo")).resolves.toEqual(Buffer.from("metadata"));
    await expect(listRootDirectory(root, "nested")).resolves.toEqual([
      expect.objectContaining({ name: "movie.nfo", path: "nested/movie.nfo", kind: "file" }),
    ]);
    await expect(statRootPath(root, "nested//movie.nfo")).resolves.toEqual(
      expect.objectContaining({ name: "movie.nfo", path: "nested/movie.nfo", kind: "file" }),
    );
    expect(toRootRelativePath(root, path.join(root.hostPath, "nested", "movie.nfo"))).toBe("nested/movie.nfo");
  });

  it("walks files with desktop-compatible symlink semantics", async () => {
    const root = await createTempRoot();
    await atomicWriteRootFile(root, "movie.mkv", "video");
    await atomicWriteRootFile(root, "linked/target.mp4", "video");
    await mkdir(path.join(root.hostPath, "links"), { recursive: true });
    try {
      await symlink(path.join(root.hostPath, "linked"), path.join(root.hostPath, "links", "linked-dir"), "dir");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        return;
      }
      throw error;
    }

    await expect(listRootFiles(root, "", true)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relativePath: "movie.mkv" }),
        expect.objectContaining({ relativePath: "links/linked-dir/target.mp4" }),
      ]),
    );
  });

  it("maps missing filesystem paths to stable missing-path errors", async () => {
    const root = await createTempRoot();

    await expect(readRootFile(root, "missing.nfo")).rejects.toEqual(
      expect.objectContaining({ code: storageErrorCodes.MissingPath }),
    );
  });
});
