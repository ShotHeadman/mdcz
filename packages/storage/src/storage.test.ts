import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
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

const tempRoots: string[] = [];

const createTempRoot = async () => {
  const rootPath = await mkdtemp(path.join(tmpdir(), "mdcz-storage-"));
  tempRoots.push(rootPath);
  return createMediaRoot({
    id: "root-1",
    displayName: "Movies",
    hostPath: rootPath,
    now: new Date("2026-04-28T00:00:00.000Z"),
  });
};

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((rootPath) => rm(rootPath, { recursive: true, force: true })));
});

describe("storage root-relative paths", () => {
  it("creates stable mounted filesystem roots", async () => {
    const rootPath = await mkdtemp(path.join(tmpdir(), "mdcz-storage-"));
    tempRoots.push(rootPath);

    expect(
      createMediaRoot({
        id: "root-1",
        displayName: "  Movies  ",
        hostPath: path.join(rootPath, "."),
        enabled: false,
        now: new Date("2026-04-28T00:00:00.000Z"),
      }),
    ).toEqual({
      id: "root-1",
      displayName: "Movies",
      hostPath: path.resolve(rootPath),
      rootType: "mounted-filesystem",
      enabled: false,
      createdAt: new Date("2026-04-28T00:00:00.000Z"),
      updatedAt: new Date("2026-04-28T00:00:00.000Z"),
    });
  });

  it("normalizes portable root-relative paths", () => {
    expect(normalizeRootRelativePath("folder//movie.mkv")).toBe("folder/movie.mkv");
    expect(normalizeRootRelativePath("./folder/../movie.mkv")).toBe("movie.mkv");
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

  it("rejects disabled roots with a stable unsupported-operation error", async () => {
    const root = await createTempRoot();
    const disabledRoot = { ...root, enabled: false };

    await expect(readRootFile(disabledRoot, "movie.nfo")).rejects.toEqual(
      expect.objectContaining({ code: storageErrorCodes.UnsupportedOperation }),
    );
  });

  it("maps missing filesystem paths to stable missing-path errors", async () => {
    const root = await createTempRoot();

    await expect(readRootFile(root, "missing.nfo")).rejects.toEqual(
      expect.objectContaining({ code: storageErrorCodes.MissingPath }),
    );
  });
});
