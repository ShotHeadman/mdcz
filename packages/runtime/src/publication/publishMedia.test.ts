import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryPublicationJournal } from "./memoryJournal";
import { outputFileSystem } from "./outputFileSystem";
import { commitPublishedMedia } from "./publishMedia";
import type { MoviePublicationPlan } from "./types";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const fixture = async (mode: "write" | "move", parts = 1) => {
  const directory = await mkdtemp(path.join(tmpdir(), "mdcz-output-"));
  directories.push(directory);
  await mkdir(path.join(directory, "output"));
  const ref = (relativePath: string) => ({ rootId: "root", relativePath });
  const files: MoviePublicationPlan["files"] = [];
  for (let index = 1; index <= parts; index++) {
    const name = `movie-${index}.mp4`;
    await writeFile(path.join(directory, name), "video");
    const source = ref(name);
    const target = mode === "move" ? ref(`output/${name}`) : source;
    files.push({
      fileId: `file-${index}`,
      source,
      target,
      size: 5,
      sourceSize: 5,
      modifiedAt: new Date(),
      assets: [],
      operations: mode === "move" ? [{ kind: "move", source, target, size: 5, replaceExisting: false }] : [],
    });
  }
  const plan: MoviePublicationPlan = {
    kind: "movie",
    movieId: "movie",
    operationId: "run:movie",
    operationType: "scrape",
    expected: { files: [], assets: [] },
    files,
    movieAssets: [],
    obsolete: [],
    operations: [
      {
        kind: "write",
        target: ref(mode === "write" ? "movie.nfo" : "output/movie.nfo"),
        replaceExisting: true,
        content: { kind: "text", data: "metadata" },
      },
    ],
  };
  const journal = createMemoryPublicationJournal();
  const commit = vi.fn(() => "committed");
  const options = { journal, commit, resolveRoot: async () => ({ id: "root", hostPath: directory }) };
  return { directory, plan, options, journal, commit };
};

describe("movie outputs", () => {
  it("replaces write artifacts idempotently without journals, capacity checks, or source mutation", async () => {
    const test = await fixture("write");
    const source = path.join(test.directory, "movie-1.mp4");
    const before = await stat(source);
    await writeFile(path.join(test.directory, "movie.nfo"), "original");
    const begin = vi.spyOn(test.journal, "begin");
    const copyFile = vi.fn(outputFileSystem.copyFile);
    const stagingDir = path.join(test.directory, ".mdcz-staging-test");
    await mkdir(stagingDir);
    const downloaded = path.join(stagingDir, "poster.jpg");
    test.plan.operations.push({
      kind: "copy",
      sourcePath: downloaded,
      target: { rootId: "root", relativePath: "poster.jpg" },
      size: 6,
      replaceExisting: true,
      consume: true,
    });
    for (let iteration = 0; iteration < 2; iteration++) {
      await writeFile(downloaded, "poster");
      expect(
        await commitPublishedMedia(test.plan, {
          ...test.options,
          fileSystem: { ...outputFileSystem, copyFile },
        }),
      ).toEqual({ value: "committed", cleanupIssues: [] });
    }
    expect(copyFile).not.toHaveBeenCalled();
    expect(await readFile(path.join(test.directory, "poster.jpg"), "utf8")).toBe("poster");
    expect(await readdir(stagingDir)).toEqual([]);
    await rm(stagingDir, { recursive: true });
    expect(begin).not.toHaveBeenCalled();
    expect(await readFile(source, "utf8")).toBe("video");
    expect((await stat(source)).mtimeMs).toBe(before.mtimeMs);
    expect(await readFile(path.join(test.directory, "movie.nfo"), "utf8")).toBe("metadata");
    expect((await readdir(test.directory)).sort()).toEqual(["movie-1.mp4", "movie.nfo", "output", "poster.jpg"]);
  });

  it.each([
    false,
    true,
  ])("moves complete groups with one required transfer per source (cross-device=%s)", async (crossDevice) => {
    const test = await fixture("move", 2);
    const copyFile = vi.fn(outputFileSystem.copyFile);
    const rename = vi.fn(async (source: string, target: string) => {
      if (crossDevice && path.dirname(source) === test.directory)
        throw Object.assign(new Error("cross-device"), { code: "EXDEV" });
      await outputFileSystem.rename(source, target);
    });
    expect(
      await commitPublishedMedia(test.plan, { ...test.options, fileSystem: { ...outputFileSystem, copyFile, rename } }),
    ).toEqual({ value: "committed", cleanupIssues: [] });
    for (let index = 1; index <= 2; index++) {
      expect(await readFile(path.join(test.directory, `output/movie-${index}.mp4`), "utf8")).toBe("video");
      await expect(stat(path.join(test.directory, `movie-${index}.mp4`))).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(copyFile).toHaveBeenCalledTimes(crossDevice ? 2 : 0);
    if (!crossDevice)
      expect(rename.mock.calls.filter(([source]) => path.dirname(source) === test.directory)).toHaveLength(2);
    expect(test.commit).toHaveBeenCalledOnce();
    expect(test.journal.listUnfinished()).toEqual([]);
    expect((await readdir(path.join(test.directory, "output"))).sort()).toEqual([
      "movie-1.mp4",
      "movie-2.mp4",
      "movie.nfo",
    ]);
  });

  it.each([
    "media",
    "artifact",
    "late",
    "dangling-link",
  ])("rejects move destination conflicts without replacement: %s", async (scenario) => {
    if (scenario === "dangling-link" && process.platform === "win32") return;
    const test = await fixture("move");
    const target = path.join(test.directory, scenario === "artifact" ? "output/movie.nfo" : "output/movie-1.mp4");
    test.plan.files[0].operations[0].replaceExisting = true;
    if (scenario === "dangling-link") await symlink("missing.mp4", target);
    else if (scenario !== "late") await writeFile(target, "foreign");
    const write = outputFileSystem.writeFile;
    await expect(
      commitPublishedMedia(test.plan, {
        ...test.options,
        fileSystem: {
          ...outputFileSystem,
          writeFile: async (file, data, options) => {
            await write(file, data, options);
            if (scenario === "late" && file.endsWith(".part")) await writeFile(target, "foreign");
          },
        },
      }),
    ).rejects.toThrow();
    expect(await readFile(path.join(test.directory, "movie-1.mp4"), "utf8")).toBe("video");
    if (scenario !== "dangling-link") expect(await readFile(target, "utf8")).toBe("foreign");
    expect(test.commit).not.toHaveBeenCalled();
    expect(test.journal.listUnfinished()).toEqual([]);
  });

  it.each([
    "artifact",
    "second-member",
    "commit",
    "cross-device-copy",
  ])("rolls back the entire move group on failure: %s", async (failure) => {
    const test = await fixture("move", 2);
    const options = {
      ...test.options,
      fileSystem: {
        ...outputFileSystem,
        writeFile: async (...args: Parameters<typeof outputFileSystem.writeFile>) => {
          if (failure === "artifact") throw new Error("injected failure");
          await outputFileSystem.writeFile(...args);
        },
        rename: async (source: string, target: string) => {
          if (failure === "cross-device-copy" && source === path.join(test.directory, "movie-1.mp4"))
            throw Object.assign(new Error("cross-device"), { code: "EXDEV" });
          if (failure === "second-member" && source === path.join(test.directory, "movie-2.mp4"))
            throw new Error("injected failure");
          await outputFileSystem.rename(source, target);
        },
        copyFile: async (source: string, target: string) => {
          if (failure === "cross-device-copy") {
            await writeFile(target, "partial");
            throw new Error("injected failure");
          }
          await outputFileSystem.copyFile(source, target);
        },
      },
      commit: () => {
        if (failure === "commit") throw new Error("injected failure");
        return "committed";
      },
    };
    await expect(commitPublishedMedia(test.plan, options)).rejects.toThrow("injected failure");
    for (const index of [1, 2])
      expect(await readFile(path.join(test.directory, `movie-${index}.mp4`), "utf8")).toBe("video");
    expect(await readdir(path.join(test.directory, "output"))).toEqual([]);
    expect(test.journal.listUnfinished()).toEqual([]);
  });

  it.each([false, true])("relocates rewritten STRMs and restores original content on failure: %s", async (failure) => {
    const test = await fixture("move");
    test.plan.files[0].operations = [
      {
        kind: "write",
        target: test.plan.files[0].target,
        content: { kind: "text", data: "rewritten" },
        replaceExisting: false,
      },
    ];
    test.plan.obsolete = [test.plan.files[0].source];
    const publication = commitPublishedMedia(test.plan, {
      ...test.options,
      commit: () => {
        if (failure) throw new Error("commit failure");
        return "committed";
      },
    });
    if (failure) {
      await expect(publication).rejects.toThrow("commit failure");
      expect(await readFile(path.join(test.directory, "movie-1.mp4"), "utf8")).toBe("video");
      expect(await readdir(path.join(test.directory, "output"))).toEqual([]);
    } else {
      await publication;
      expect(await readFile(path.join(test.directory, "output/movie-1.mp4"), "utf8")).toBe("rewritten");
    }
    expect(test.journal.listUnfinished()).toEqual([]);
  });
});
