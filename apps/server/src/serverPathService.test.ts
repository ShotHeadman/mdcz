import type { Dirent, Stats } from "node:fs";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultConfiguration } from "@mdcz/shared/config";
import { describe, expect, it } from "vitest";
import type { ServerConfigService } from "./configService";
import type { MediaRootService } from "./mediaRootService";
import { type ServerPathFs, ServerPathService } from "./serverPathService";

const createFakeMediaRoots = (hostPath: string): MediaRootService =>
  ({
    list: async () => ({
      roots: [
        {
          id: "root",
          displayName: "Media",
          hostPath,
          rootType: "mounted-filesystem",
          enabled: true,
          deleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    }),
  }) as MediaRootService;

const createFakeConfig = (mediaPath = ""): ServerConfigService =>
  ({
    get: async () => ({
      ...defaultConfiguration,
      paths: {
        ...defaultConfiguration.paths,
        mediaPath,
      },
    }),
  }) as ServerConfigService;

const fakeDirectoryStats = {
  isDirectory: () => true,
  isSymbolicLink: () => false,
} as Stats;

describe("ServerPathService", () => {
  it("lists matching child directories without returning files or symlinks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mdcz-server-path-"));
    const movies = path.join(root, "Movies");
    const music = path.join(root, "Music");
    const linked = path.join(root, "MovieLink");
    await mkdir(movies);
    await mkdir(music);
    await writeFile(path.join(root, "Movie.txt"), "not a directory");

    let symlinkCreated = false;
    try {
      await symlink(movies, linked, process.platform === "win32" ? "junction" : "dir");
      symlinkCreated = true;
    } catch {
      symlinkCreated = false;
    }

    const service = new ServerPathService(createFakeMediaRoots(root), createFakeConfig(root));
    const response = await service.suggest({ path: path.join(root, "Mov") });

    expect(response.accessible).toBe(true);
    expect(response.parentPath).toBe(process.platform === "win32" ? root.replaceAll("\\", "/") : root);
    expect(response.entries.map((entry) => entry.name)).toEqual(["Movies"]);
    expect(response.entries.every((entry) => entry.type === "directory")).toBe(true);
    if (symlinkCreated) {
      expect(response.entries.map((entry) => entry.name)).not.toContain("MovieLink");
    }
  });

  it("returns configured and system root shortcuts for an empty path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mdcz-server-path-root-"));
    const service = new ServerPathService(createFakeMediaRoots(root), createFakeConfig(root));
    const response = await service.suggest({ path: "" });

    expect(response.accessible).toBe(true);
    expect(response.entries.map((entry) => entry.path)).toContain(
      process.platform === "win32" ? root.replaceAll("\\", "/") : root,
    );
  });

  it("handles inaccessible directories as controlled empty responses", async () => {
    const fs: ServerPathFs = {
      access: async () => undefined,
      lstat: async () => fakeDirectoryStats,
      readdir: async () => {
        throw new Error("permission denied");
      },
    };
    const service = new ServerPathService(createFakeMediaRoots("/media"), createFakeConfig("/media"), {
      fs,
      platform: "linux",
    });

    const response = await service.suggest({ path: "/media/" });

    expect(response).toMatchObject({
      path: "/media",
      parentPath: "/media",
      exists: true,
      accessible: false,
      entries: [],
      error: "permission denied",
    });
  });

  it("normalizes Windows-style root and parent paths through the platform seam", async () => {
    const entries = [
      {
        name: "Media",
        isDirectory: () => true,
      },
    ] as Dirent[];
    const fs: ServerPathFs = {
      access: async () => undefined,
      lstat: async (candidate) =>
        candidate.replaceAll("\\", "/").toLocaleLowerCase() === "e:/med"
          ? Promise.reject(new Error("missing"))
          : fakeDirectoryStats,
      readdir: async () => entries,
    };
    const service = new ServerPathService(createFakeMediaRoots("E:/Media"), createFakeConfig("E:/Media"), {
      fs,
      platform: "win32",
    });

    const response = await service.suggest({ path: "E:/Med" });

    expect(response.parentPath).toBe("E:/");
    expect(response.entries).toEqual([
      {
        type: "directory",
        name: "Media",
        label: "Media",
        path: "E:/Media",
      },
    ]);
  });
});
