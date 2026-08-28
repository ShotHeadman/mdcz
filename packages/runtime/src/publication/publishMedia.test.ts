import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryPublicationJournal } from "./memoryJournal";
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
    metadataRoot,
    outputRoot,
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

const residue = async (...roots: string[]): Promise<string[]> => {
  const names: string[] = [];
  for (const root of roots) {
    const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (entry.name.endsWith(".part") || entry.name.endsWith(".bak")) names.push(entry.name);
    }
  }
  return names;
};

describe("commitPublishedMedia", () => {
  it("publishes across roots, commits once, then removes sources and obsolete files", async () => {
    const test = await fixture();
    const commit = vi.fn(() => "committed");
    await expect(
      commitPublishedMedia(test.plan, {
        resolveRoot: test.resolveRoot,
        journal: createMemoryPublicationJournal(),
        commit,
      }),
    ).resolves.toBe("committed");
    expect(commit).toHaveBeenCalledOnce();
    await expect(readFile(test.target, "utf8")).resolves.toBe("video");
    await expect(readFile(test.nfo, "utf8")).resolves.toBe("<movie/>");
    await expect(readFile(test.poster, "utf8")).resolves.toBe("poster");
    await expect(stat(test.source)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(test.obsolete)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(residue(test.outputRoot, test.metadataRoot)).resolves.toEqual([]);
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
    const commit = vi.fn(() => undefined);
    const journal = createMemoryPublicationJournal();
    await expect(
      commitPublishedMedia(test.plan, { resolveRoot: test.resolveRoot, journal, commit, fileSystem }),
    ).rejects.toThrow(`${method} failed`);
    expect(commit).not.toHaveBeenCalled();
    await expect(readFile(test.source, "utf8")).resolves.toBe("video");
    await expect(stat(test.target)).rejects.toMatchObject({ code: "ENOENT" });
    expect(journal.listUnfinished()).toEqual([]);
    await expect(residue(test.outputRoot, test.metadataRoot)).resolves.toEqual([]);
  });

  it("restores the original target byte-for-byte when commit throws", async () => {
    const test = await fixture();
    await mkdir(path.dirname(test.nfo), { recursive: true });
    await writeFile(test.nfo, "original-nfo");
    test.plan.replaceExistingTargets = [{ rootId: "metadata", relativePath: "Movie/movie.nfo" }];
    const journal = createMemoryPublicationJournal();
    await expect(
      commitPublishedMedia(test.plan, {
        resolveRoot: test.resolveRoot,
        journal,
        commit: () => {
          throw new Error("database unavailable");
        },
      }),
    ).rejects.toThrow("database unavailable");
    await expect(readFile(test.nfo, "utf8")).resolves.toBe("original-nfo");
    await expect(readFile(test.source, "utf8")).resolves.toBe("video");
    await expect(stat(test.target)).rejects.toMatchObject({ code: "ENOENT" });
    expect(journal.listUnfinished()).toEqual([]);
    await expect(residue(test.outputRoot, test.metadataRoot)).resolves.toEqual([]);
  });

  it("rolls back files 1-2 when file 3 of 5 fails", async () => {
    const test = await fixture();
    test.plan.video = undefined;
    test.plan.obsolete = [];
    test.plan.artifacts = [1, 2, 3, 4, 5].map((index) => ({
      target: { rootId: "metadata" as const, relativePath: `Movie/file-${index}.txt` },
      content: { kind: "text" as const, data: `content-${index}` },
    }));
    const fileSystem = await defaultFileSystem();
    const originalRename = fileSystem.rename;
    let renames = 0;
    fileSystem.rename = async (source, target) => {
      renames += 1;
      if (renames === 3) throw new Error("rename failed on file 3");
      await originalRename(source, target);
    };
    await expect(
      commitPublishedMedia(test.plan, {
        resolveRoot: test.resolveRoot,
        journal: createMemoryPublicationJournal(),
        commit: () => undefined,
        fileSystem,
      }),
    ).rejects.toThrow("rename failed on file 3");
    for (const index of [1, 2, 3, 4, 5]) {
      await expect(stat(path.join(test.metadataRoot, `Movie/file-${index}.txt`))).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
    await expect(residue(test.metadataRoot)).resolves.toEqual([]);
  });

  it("preserves the backup, records a repair issue, and throws AggregateError when rollback fails", async () => {
    const test = await fixture();
    await mkdir(path.dirname(test.nfo), { recursive: true });
    await writeFile(test.nfo, "original-nfo");
    test.plan.replaceExistingTargets = [{ rootId: "metadata", relativePath: "Movie/movie.nfo" }];
    test.plan.video = undefined;
    const nfo = test.plan.artifacts[0];
    if (!nfo) throw new Error("fixture nfo artifact is required");
    test.plan.artifacts = [nfo];
    test.plan.obsolete = [];
    const fileSystem = await defaultFileSystem();
    const originalRename = fileSystem.rename;
    fileSystem.rename = async (source, target) => {
      if (source.endsWith(".bak")) throw new Error("restore failed");
      await originalRename(source, target);
    };
    const repairIssues = { record: vi.fn(() => undefined), resolve: vi.fn(() => undefined) };
    const journal = createMemoryPublicationJournal();
    const error = await commitPublishedMedia(test.plan, {
      resolveRoot: test.resolveRoot,
      journal,
      repairIssues,
      fileSystem,
      commit: () => {
        throw new Error("database unavailable");
      },
    }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors.map((item) => (item as Error).message)).toEqual([
      "database unavailable",
      "restore failed",
    ]);
    expect(repairIssues.record).toHaveBeenCalledOnce();
    await expect(readFile(test.nfo, "utf8")).resolves.toBe("<movie/>");
    const backups = await residue(test.metadataRoot);
    expect(backups.some((name) => name.endsWith(".bak"))).toBe(true);
    expect(journal.listUnfinished()).toHaveLength(1);
  });

  it("reports post-commit cleanup failure as committed and does not roll back", async () => {
    const test = await fixture();
    const fileSystem = await defaultFileSystem();
    const originalRm = fileSystem.rm;
    fileSystem.rm = async (filePath, options) => {
      if (filePath === test.source) throw new Error("source cleanup failed");
      await originalRm(filePath, options);
    };
    const error = await commitPublishedMedia(test.plan, {
      resolveRoot: test.resolveRoot,
      journal: createMemoryPublicationJournal(),
      fileSystem,
      commit: () => "committed",
    }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(PublicationError);
    expect(error).toMatchObject({ committed: true });
    await expect(readFile(test.target, "utf8")).resolves.toBe("video");
    await expect(readFile(test.nfo, "utf8")).resolves.toBe("<movie/>");
  });

  it("retains the source until the database commit for a copied video", async () => {
    const test = await fixture();
    const commit = vi.fn(() => {
      expect(existsSync(test.source)).toBe(true);
      expect(readFileSync(test.source, "utf8")).toBe("video");
      return "committed";
    });
    await expect(
      commitPublishedMedia(test.plan, {
        resolveRoot: test.resolveRoot,
        journal: createMemoryPublicationJournal(),
        commit,
      }),
    ).resolves.toBe("committed");
    expect(commit).toHaveBeenCalledOnce();
    await expect(stat(test.source)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a copied video whose verification size is wrong", async () => {
    const test = await fixture();
    const fileSystem = await defaultFileSystem();
    const originalStat = fileSystem.stat;
    fileSystem.stat = vi.fn(async (filePath) => {
      const info = await originalStat(filePath);
      if (filePath.includes("movie.mp4") && filePath.endsWith(".part"))
        Object.defineProperty(info, "size", { value: info.size + 1 });
      return info;
    });
    await expect(
      commitPublishedMedia(test.plan, {
        resolveRoot: test.resolveRoot,
        journal: createMemoryPublicationJournal(),
        commit: () => undefined,
        fileSystem,
      }),
    ).rejects.toThrow("Copied video size mismatch");
    expect(await readFile(test.source, "utf8")).toBe("video");
    await expect(stat(test.target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("deletes obsolete assets only after a successful commit", async () => {
    const test = await fixture();
    const commit = vi.fn(() => {
      expect(readFileSync(test.obsolete, "utf8")).toBe("old");
      return "committed";
    });
    await expect(
      commitPublishedMedia(test.plan, {
        resolveRoot: test.resolveRoot,
        journal: createMemoryPublicationJournal(),
        commit,
      }),
    ).resolves.toBe("committed");
    expect(commit).toHaveBeenCalledOnce();
    await expect(stat(test.obsolete)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("repeats a completed operation without changing the library identity", async () => {
    const test = await fixture();
    const commit = vi.fn(() => ({ libraryItemId: "library-item-1" }));
    const options = { resolveRoot: test.resolveRoot, journal: createMemoryPublicationJournal(), commit };

    await expect(commitPublishedMedia(test.plan, options)).resolves.toEqual({ libraryItemId: "library-item-1" });
    await expect(commitPublishedMedia(test.plan, options)).resolves.toEqual({ libraryItemId: "library-item-1" });
    expect(commit).toHaveBeenCalledTimes(2);
  });
});
