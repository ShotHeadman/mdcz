import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  atomicWriteRootFile,
  createMediaRoot,
  listRootDirectory,
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
