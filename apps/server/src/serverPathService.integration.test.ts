import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTempDirectory } from "../../../tests/harness/tempDirectory";
import { createFakeConfig, createFakeMediaRoots } from "./serverPathService.testSupport";
import { ServerPathService } from "./services/serverPathService";

describe("ServerPathService filesystem integration", () => {
  it("lists matching child directories without returning files or symlinks", async () => {
    const directory = await createTempDirectory("server-path");

    try {
      const movies = path.join(directory.path, "Movies");
      const music = path.join(directory.path, "Music");
      const linked = path.join(directory.path, "MovieLink");
      await mkdir(movies);
      await mkdir(music);
      await writeFile(path.join(directory.path, "Movie.txt"), "not a directory");

      let symlinkCreated = false;
      try {
        await symlink(movies, linked, process.platform === "win32" ? "junction" : "dir");
        symlinkCreated = true;
      } catch {
        symlinkCreated = false;
      }

      const service = new ServerPathService(createFakeMediaRoots(directory.path), createFakeConfig(directory.path));
      const response = await service.suggest({ path: path.join(directory.path, "Mov") });

      expect(response.accessible).toBe(true);
      expect(response.parentPath).toBe(
        process.platform === "win32" ? directory.path.replaceAll("\\", "/") : directory.path,
      );
      expect(response.entries.map((entry) => entry.name)).toEqual(["Movies"]);
      expect(response.entries.every((entry) => entry.type === "directory")).toBe(true);
      if (symlinkCreated) {
        expect(response.entries.map((entry) => entry.name)).not.toContain("MovieLink");
      }
    } finally {
      await directory.cleanup();
    }
  });

  it("returns configured and system root shortcuts for an empty path", async () => {
    const directory = await createTempDirectory("server-path-root");

    try {
      const service = new ServerPathService(createFakeMediaRoots(directory.path), createFakeConfig(directory.path));
      const response = await service.suggest({ path: "" });

      expect(response.accessible).toBe(true);
      expect(response.entries.map((entry) => entry.path)).toContain(
        process.platform === "win32" ? directory.path.replaceAll("\\", "/") : directory.path,
      );
    } finally {
      await directory.cleanup();
    }
  });
});
