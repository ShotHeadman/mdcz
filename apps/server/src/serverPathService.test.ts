import type { Dirent, Stats } from "node:fs";
import { describe, expect, it } from "vitest";
import { createFakeConfig, createFakeMediaRoots } from "./serverPathService.testSupport";
import { type ServerPathFs, ServerPathService } from "./services/serverPathService";

const fakeDirectoryStats = {
  isDirectory: () => true,
  isSymbolicLink: () => false,
} as Stats;

describe("ServerPathService", () => {
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
