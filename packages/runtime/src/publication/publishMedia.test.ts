import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commitPublishedMedia } from "./publishMedia";
import { PublicationError, type PublicationFileSystem, type PublicationPlan } from "./types";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (directory) => await rm(directory, { recursive: true, force: true })),
  );
});

const fixture = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "mdcz-publication-"));
  directories.push(directory);
  const inputRoot = path.join(directory, "input");
  const outputRoot = path.join(directory, "output");
  const metadataRoot = path.join(directory, "metadata");
  await Promise.all([mkdir(inputRoot), mkdir(outputRoot), mkdir(metadataRoot)]);
  const source = path.join(inputRoot, "movie.mp4");
  const obsolete = path.join(metadataRoot, "old.jpg");
  await Promise.all([writeFile(source, "video"), writeFile(obsolete, "old")]);
  const roots = new Map([
    ["input", { id: "input", hostPath: inputRoot }],
    ["output", { id: "output", hostPath: outputRoot }],
    ["metadata", { id: "metadata", hostPath: metadataRoot }],
  ]);
  const plan: PublicationPlan = {
    operationId: "run:item",
    operationType: "scrape",
    video: {
      source: { rootId: "input", relativePath: "movie.mp4" },
      target: { rootId: "output", relativePath: "Movie/movie.mp4" },
      size: 5,
    },
    artifacts: [
      { target: { rootId: "metadata", relativePath: "Movie/movie.nfo" }, content: { kind: "text", data: "<movie/>" } },
      {
        target: { rootId: "metadata", relativePath: "Movie/poster.jpg" },
        content: { kind: "bytes", data: Buffer.from("poster") },
      },
    ],
    assets: [
      { type: "local", kind: "poster", file: { rootId: "metadata", relativePath: "Movie/poster.jpg" } },
      { type: "remote", kind: "trailer", url: "https://example.test/trailer.mp4" },
    ],
    obsolete: [{ rootId: "metadata", relativePath: "old.jpg" }],
  };
  return {
    plan,
    resolveRoot: async (rootId: string) => {
      const root = roots.get(rootId);
      if (!root) throw new Error(`missing root ${rootId}`);
      return root;
    },
    source,
    obsolete,
    target: path.join(outputRoot, "Movie/movie.mp4"),
    nfo: path.join(metadataRoot, "Movie/movie.nfo"),
    poster: path.join(metadataRoot, "Movie/poster.jpg"),
  };
};

const defaultFileSystem = async (): Promise<PublicationFileSystem> => {
  const fs = await import("node:fs/promises");
  return {
    copyFile: fs.copyFile,
    mkdir: fs.mkdir,
    readFile: fs.readFile,
    rename: fs.rename,
    rm: fs.rm,
    stat: fs.stat,
    statfs: fs.statfs,
    writeFile: fs.writeFile,
  };
};

describe("commitPublishedMedia", () => {
  it("publishes across roots, commits once, then removes sources and obsolete files", async () => {
    const test = await fixture();
    const commit = vi.fn(async () => "committed");
    await expect(commitPublishedMedia(test.plan, { resolveRoot: test.resolveRoot, commit })).resolves.toBe("committed");
    expect(commit).toHaveBeenCalledOnce();
    await expect(readFile(test.target, "utf8")).resolves.toBe("video");
    await expect(readFile(test.nfo, "utf8")).resolves.toBe("<movie/>");
    await expect(readFile(test.poster, "utf8")).resolves.toBe("poster");
    await expect(stat(test.source)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(test.obsolete)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    "writeFile",
    "copyFile",
    "rename",
  ] as const)("cleans partial publication and preserves the source when %s fails", async (method) => {
    const test = await fixture();
    const fileSystem = await defaultFileSystem();
    const original = fileSystem[method];
    fileSystem[method] = vi.fn(async (...args: never[]) => {
      void original;
      void args;
      throw new Error(`${method} failed`);
    }) as never;
    const commit = vi.fn(async () => undefined);
    await expect(
      commitPublishedMedia(test.plan, { resolveRoot: test.resolveRoot, commit, fileSystem }),
    ).rejects.toThrow(`${method} failed`);
    expect(commit).not.toHaveBeenCalled();
    await expect(readFile(test.source, "utf8")).resolves.toBe("video");
    await expect(stat(test.target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("records a database-after-files issue and safely completes on repeat", async () => {
    const test = await fixture();
    const repairIssues = { record: vi.fn(async () => undefined), resolve: vi.fn(async () => undefined) };
    await expect(
      commitPublishedMedia(test.plan, {
        resolveRoot: test.resolveRoot,
        repairIssues,
        commit: async () => {
          throw new Error("database unavailable");
        },
      }),
    ).rejects.toMatchObject({ committed: false, operationId: "run:item" });
    expect(repairIssues.record).toHaveBeenCalledOnce();
    await expect(readFile(test.target, "utf8")).resolves.toBe("video");
    await expect(readFile(test.source, "utf8")).resolves.toBe("video");

    await expect(
      commitPublishedMedia(test.plan, { resolveRoot: test.resolveRoot, repairIssues, commit: async () => "repaired" }),
    ).resolves.toBe("repaired");
    await expect(stat(test.source)).rejects.toMatchObject({ code: "ENOENT" });
    expect(repairIssues.resolve).toHaveBeenCalled();
  });

  it("reports post-commit cleanup failure as committed", async () => {
    const test = await fixture();
    const fileSystem = await defaultFileSystem();
    const originalRm = fileSystem.rm;
    fileSystem.rm = async (filePath, options) => {
      if (filePath === test.source) throw new Error("source cleanup failed");
      await originalRm(filePath, options);
    };
    const error = await commitPublishedMedia(test.plan, {
      resolveRoot: test.resolveRoot,
      fileSystem,
      commit: async () => "committed",
    }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(PublicationError);
    expect(error).toMatchObject({ committed: true });
    await expect(readFile(test.target, "utf8")).resolves.toBe("video");
  });

  it("rejects a copied video whose verification size is wrong", async () => {
    const test = await fixture();
    const fileSystem = await defaultFileSystem();
    const originalStat = fileSystem.stat;
    fileSystem.stat = vi.fn(async (filePath) => {
      const info = await originalStat(filePath);
      if (filePath.endsWith(".part")) Object.defineProperty(info, "size", { value: info.size + 1 });
      return info;
    });
    await expect(
      commitPublishedMedia(test.plan, { resolveRoot: test.resolveRoot, commit: async () => undefined, fileSystem }),
    ).rejects.toThrow("Copied video size mismatch");
    expect(await readFile(test.source, "utf8")).toBe("video");
    await expect(stat(test.target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("deletes obsolete assets only after a successful commit", async () => {
    const test = await fixture();
    const commit = vi.fn(async () => {
      await expect(readFile(test.obsolete, "utf8")).resolves.toBe("old");
      return "committed";
    });
    await expect(commitPublishedMedia(test.plan, { resolveRoot: test.resolveRoot, commit })).resolves.toBe("committed");
    expect(commit).toHaveBeenCalledOnce();
    await expect(stat(test.obsolete)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("repeats a completed operation without changing the library identity", async () => {
    const test = await fixture();
    const commit = vi.fn(async () => ({ libraryItemId: "library-item-1" }));

    await expect(commitPublishedMedia(test.plan, { resolveRoot: test.resolveRoot, commit })).resolves.toEqual({
      libraryItemId: "library-item-1",
    });
    await expect(commitPublishedMedia(test.plan, { resolveRoot: test.resolveRoot, commit })).resolves.toEqual({
      libraryItemId: "library-item-1",
    });
    expect(commit).toHaveBeenCalledTimes(2);
  });
});
