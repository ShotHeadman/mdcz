import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicationConflictError } from "./conflicts";
import { createMemoryPublicationJournal } from "./memoryJournal";
import { commitPublishedMedia } from "./publishMedia";
import type { MoviePublicationPlan, PublicationFileSystem } from "./types";

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
  const plan: MoviePublicationPlan = {
    operationId: "run:item",
    operationType: "scrape",
    kind: "movie",
    movieId: "movie",
    expected: { files: [], assets: [] },
    files: [
      {
        source: { rootId: "input", relativePath: "movie.mp4" },
        target: { rootId: "output", relativePath: "Movie/movie.mp4" },
        fileId: "file",
        operations: [],
        size: 5,
        sourceSize: 5,
        modifiedAt: new Date(),
        assets: [],
      },
    ],
    operations: [
      {
        kind: "move",
        source: { rootId: "input", relativePath: "movie.mp4" },
        target: { rootId: "output", relativePath: "Movie/movie.mp4" },
        size: 5,
        replaceExisting: false,
      },
      {
        kind: "write",
        target: { rootId: "metadata", relativePath: "Movie/movie.nfo" },
        content: { kind: "text", data: "<movie/>" },
        replaceExisting: true,
      },
      {
        kind: "write",
        target: { rootId: "metadata", relativePath: "Movie/poster.jpg" },
        content: { kind: "bytes", data: Buffer.from("poster") },
        replaceExisting: true,
      },
    ],
    movieAssets: [
      { type: "local", kind: "poster", file: { rootId: "metadata", relativePath: "Movie/poster.jpg" } },
      { type: "remote", kind: "trailer", url: "https://example.test/trailer.mp4" },
    ],
    obsolete: [{ rootId: "metadata", relativePath: "old.jpg" }],
  };
  plan.files[0].operations = plan.operations.splice(0, 1);
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
  it.each([
    "existing-target",
    "wrong-scope",
  ])("rejects subtitle mutations without matching replacement permission and ownership: %s", async (scenario) => {
    const test = await fixture();
    const source = path.join(path.dirname(test.source), "movie.srt");
    const target = path.join(path.dirname(test.target), "movie.srt");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(source, "NEW");
    await writeFile(target, "OLD");
    test.plan.files[0].operations = [];
    test.plan.operations = [
      ...test.plan.operations.filter((operation) => operation.kind === "write"),
      {
        kind: "move",
        source: { rootId: "input", relativePath: "movie.srt" },
        target: { rootId: "output", relativePath: "Movie/movie.srt" },
        size: 3,
        replaceExisting: scenario === "wrong-scope",
      },
    ];
    test.plan.files[0].assets = [
      { type: "local", kind: "subtitle", file: { rootId: "output", relativePath: "Movie/movie.srt" } },
    ];
    if (scenario !== "wrong-scope") test.plan.files[0].operations.push(...test.plan.operations.splice(-1));
    const commit = vi.fn(() => "committed");
    const options = { resolveRoot: test.resolveRoot, journal: createMemoryPublicationJournal(), commit };
    const conflict = await commitPublishedMedia(test.plan, options).catch((error) => error);
    expect(conflict).toBeInstanceOf(PublicationConflictError);
    expect(conflict.message).toContain(scenario === "wrong-scope" ? "asset scope" : "目标附属资源已存在");
    expect(commit).not.toHaveBeenCalled();
    expect(await readFile(source, "utf8")).toBe("NEW");
    expect(await readFile(target, "utf8")).toBe("OLD");
    const subtitleMove = [...test.plan.operations, ...test.plan.files[0].operations].find(
      (operation) => operation.kind === "move",
    );
    if (!subtitleMove) throw new Error("Fixture subtitle move is required");
    subtitleMove.replaceExisting = true;
    if (scenario === "wrong-scope") test.plan.files[0].operations.push(...test.plan.operations.splice(-1));
    await expect(commitPublishedMedia(test.plan, options)).resolves.toEqual({ value: "committed", cleanupIssues: [] });
    expect(await readFile(target, "utf8")).toBe("NEW");
    expect(existsSync(source)).toBe(false);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("preserves source entries and enforces cross-device copy rules: %s", async (crossDevice) => {
    const entryKinds = ["regular"];
    if (process.platform !== "win32") entryKinds.push("absolute-link");
    if (process.platform !== "win32" && !crossDevice) entryKinds.push("relative-link");
    for (const entryKind of entryKinds) {
      const test = await fixture();
      test.plan.operations = test.plan.operations.filter((operation) => operation.kind !== "write");
      test.plan.movieAssets = [];
      const referent = path.join(test.metadataRoot, "referent.mp4");
      const linkTarget = entryKind === "relative-link" ? path.relative(path.dirname(test.source), referent) : referent;
      if (entryKind !== "regular") {
        await writeFile(referent, "video");
        await rm(test.source);
        await symlink(linkTarget, test.source);
        await mkdir(path.dirname(test.target), { recursive: true });
      }
      const fs = await defaultFileSystem();
      const copy = vi.fn(fs.copyFile);
      const commit = vi.fn(() => "committed");
      const options = {
        resolveRoot: test.resolveRoot,
        journal: createMemoryPublicationJournal(),
        commit,
        fileSystem: {
          ...fs,
          copyFile: copy,
          statfs: async () => ({ bavail: 0, bsize: 1 }),
          rename: async (source: string, target: string) => {
            if (crossDevice && source === test.source)
              throw Object.assign(new Error("cross-device"), { code: "EXDEV" });
            await fs.rename(source, target);
          },
        },
      };
      let error: string | null = null;
      if (entryKind === "relative-link") error = "preserving its target";
      else if (crossDevice) error = entryKind === "regular" ? "Insufficient space" : "Cannot copy a file symlink";
      if (error) {
        await expect(commitPublishedMedia(test.plan, options)).rejects.toThrow(error);
        expect(await readFile(test.source, "utf8")).toBe("video");
        expect(commit).not.toHaveBeenCalled();
      } else {
        await expect(commitPublishedMedia(test.plan, options)).resolves.toEqual({
          value: "committed",
          cleanupIssues: [],
        });
        expect(await readFile(test.target, "utf8")).toBe("video");
        expect(existsSync(test.source)).toBe(false);
        expect(commit).toHaveBeenCalledOnce();
      }
      if (entryKind !== "regular") {
        const entry = error ? test.source : test.target;
        expect((await lstat(entry)).isSymbolicLink()).toBe(true);
        expect(await readlink(entry)).toBe(linkTarget);
        expect(await readFile(referent, "utf8")).toBe("video");
      }
      expect(copy).not.toHaveBeenCalled();
    }
  });

  it("publishes across roots, commits once, then removes sources and obsolete files", async () => {
    const test = await fixture();
    const commit = vi.fn(() => "committed");
    await expect(
      commitPublishedMedia(test.plan, {
        resolveRoot: test.resolveRoot,
        journal: createMemoryPublicationJournal(),
        commit,
      }),
    ).resolves.toEqual({ value: "committed", cleanupIssues: [] });
    expect(commit).toHaveBeenCalledOnce();
    await expect(readFile(test.target, "utf8")).resolves.toBe("video");
    await expect(readFile(test.nfo, "utf8")).resolves.toBe("<movie/>");
    await expect(readFile(test.poster, "utf8")).resolves.toBe("poster");
    await expect(stat(test.source)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(test.obsolete)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(residue(test.outputRoot, test.metadataRoot)).resolves.toEqual([]);
  });

  it("rejects commit when expected membership disappeared before publication", async () => {
    const test = await fixture();
    test.plan.expected = {
      files: [{ rootId: "input", relativePath: "movie.mp4", itemId: "movie", fileId: "file" }],
      assets: [],
    };
    const commit = vi.fn(() => undefined);
    await expect(
      commitPublishedMedia(test.plan, {
        resolveRoot: test.resolveRoot,
        journal: createMemoryPublicationJournal(),
        commit,
        outputs: {
          publicationRoots: () => [],
          publicationSnapshot: () => ({ files: [], assets: [] }),
        },
      }),
    ).rejects.toBeInstanceOf(PublicationConflictError);
    expect(commit).not.toHaveBeenCalled();
    expect(existsSync(test.source)).toBe(true);
  });

  it("publishes a long operation id with temporary files in the target directories", async () => {
    const test = await fixture();
    const operationId = `nfo-write:${path.join("/mnt/nas/library", `${"segment/".repeat(40)}movie.nfo`)}`;
    const staged: string[] = [];
    const fileSystem = await defaultFileSystem();
    const originalCopyFile = fileSystem.copyFile;
    const originalWriteFile = fileSystem.writeFile;
    fileSystem.copyFile = async (source, target) => {
      staged.push(target);
      await originalCopyFile(source, target);
    };
    fileSystem.writeFile = async (filePath, data, options) => {
      staged.push(filePath);
      await originalWriteFile(filePath, data, options);
    };

    await commitPublishedMedia(
      { ...test.plan, operationId },
      {
        resolveRoot: test.resolveRoot,
        journal: createMemoryPublicationJournal(),
        commit: () => undefined,
        fileSystem,
      },
    );

    expect(staged.length).toBeGreaterThan(0);
    for (const filePath of staged) {
      const directory = path.dirname(filePath);
      expect([path.dirname(test.nfo), path.dirname(test.poster), path.dirname(test.target)]).toContain(directory);
      expect(path.basename(filePath)).not.toContain("segment");
      expect(path.basename(filePath).length).toBeLessThan(operationId.length);
    }
    await expect(residue(test.outputRoot, test.metadataRoot)).resolves.toEqual([]);
  });

  it.each(["same", "alias", "independent"])("coordinates concurrent physical paths: %s", async (scenario) => {
    const test = await fixture();
    const fileSystem = await defaultFileSystem();
    const originalWriteFile = fileSystem.writeFile;
    let releaseStage: () => void = () => undefined;
    const stageGate = new Promise<void>((resolve) => {
      releaseStage = resolve;
    });
    let stageStarted!: () => void;
    const stageStartedPromise = new Promise<void>((resolve) => {
      stageStarted = resolve;
    });
    let paused = false;
    fileSystem.writeFile = async (filePath, data, options) => {
      await originalWriteFile(filePath, data, options);
      if (!paused && filePath.endsWith(".part")) {
        paused = true;
        stageStarted();
        await stageGate;
      }
    };

    const journal = createMemoryPublicationJournal();
    const first = commitPublishedMedia(test.plan, {
      resolveRoot: test.resolveRoot,
      journal,
      fileSystem,
      commit: () => undefined,
    });
    await stageStartedPromise;

    const second = scenario === "independent" ? await fixture() : test;
    const alias = path.join(path.dirname(test.source), "../input-alias");
    if (scenario === "alias")
      await symlink(path.dirname(test.source), alias, process.platform === "win32" ? "junction" : "dir");
    const secondPlan = structuredClone(second.plan);
    secondPlan.operationId = "run:second";
    if (scenario === "alias") {
      const video = secondPlan.files[0].operations.find((operation) => operation.kind === "move");
      if (!video) throw new Error("Expected video move");
      video.source.rootId = "alias";
    }
    const conflict = await commitPublishedMedia(secondPlan, {
      resolveRoot: async (id) => (id === "alias" ? { id, hostPath: alias } : second.resolveRoot(id)),
      journal: scenario === "independent" ? createMemoryPublicationJournal() : journal,
      fileSystem,
      commit: () => undefined,
    }).catch((error: unknown) => error);
    releaseStage();
    await first;
    if (scenario === "independent") {
      expect(conflict).toEqual({ value: undefined, cleanupIssues: [] });
      expect(await readFile(second.target, "utf8")).toBe("video");
      return;
    }
    expect(conflict).toBeInstanceOf(PublicationConflictError);
    expect(conflict).toMatchObject({
      reason: "发布路径正被其他并发任务占用",
      sourcePath: test.source,
      targetPath: test.source,
    });
  });

  it.each([
    "writeFile",
    "copyFile",
    "rename",
  ] as const)("cleans partial publication and preserves the source when %s fails", async (method) => {
    const test = await fixture();
    const fileSystem = await defaultFileSystem();
    const original = fileSystem[method];
    if (method === "copyFile")
      fileSystem.rename = async () => {
        throw Object.assign(new Error("cross-device"), { code: "EXDEV" });
      };
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

  it.each([
    false,
    true,
  ])("restores video, subtitles and original targets when commit throws (cross-device=%s)", async (crossDevice) => {
    const test = await fixture();
    const subtitleSource = `${test.source}.zh.srt`;
    const subtitleTarget = `${test.target}.zh.srt`;
    await writeFile(subtitleSource, "subtitle");
    test.plan.files[0].operations.push({
      kind: "move",
      source: { rootId: "input", relativePath: "movie.mp4.zh.srt" },
      target: { rootId: "output", relativePath: "Movie/movie.mp4.zh.srt" },
      size: 8,
      replaceExisting: true,
    });
    const fileSystem = await defaultFileSystem();
    const rename = fileSystem.rename;
    fileSystem.rename = async (source, target) => {
      if (crossDevice && (source === test.source || source === subtitleSource))
        throw Object.assign(new Error("cross-device"), { code: "EXDEV" });
      await rename(source, target);
    };
    await mkdir(path.dirname(test.nfo), { recursive: true });
    await writeFile(test.nfo, "original-nfo");
    const journal = createMemoryPublicationJournal();
    await expect(
      commitPublishedMedia(test.plan, {
        resolveRoot: test.resolveRoot,
        journal,
        fileSystem,
        commit: () => {
          throw new AggregateError([new Error("constraint failed")], "database unavailable");
        },
      }),
    ).rejects.toThrow("database unavailable");
    await expect(readFile(test.nfo, "utf8")).resolves.toBe("original-nfo");
    await expect(readFile(test.source, "utf8")).resolves.toBe("video");
    await expect(readFile(subtitleSource, "utf8")).resolves.toBe("subtitle");
    await expect(stat(subtitleTarget)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(test.target)).rejects.toMatchObject({ code: "ENOENT" });
    expect(journal.listUnfinished()).toEqual([]);
    await expect(residue(test.outputRoot, test.metadataRoot)).resolves.toEqual([]);
  });

  it("rolls back files 1-2 when file 3 of 5 fails", async () => {
    const test = await fixture();
    test.plan.files[0].operations = [];
    test.plan.operations = [];
    test.plan.obsolete = [];
    test.plan.operations = [1, 2, 3, 4, 5].map((index) => ({
      kind: "write" as const,
      target: { rootId: "metadata" as const, relativePath: `Movie/file-${index}.txt` },
      content: { kind: "text" as const, data: `content-${index}` },
      replaceExisting: false,
    }));
    test.plan.movieAssets = [];
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

  it("revalidates each target immediately before its rename", async () => {
    const test = await fixture();
    test.plan.files[0].operations = [];
    test.plan.operations = [];
    test.plan.movieAssets = [];
    test.plan.obsolete = [];
    test.plan.operations = [1, 2].map((index) => ({
      kind: "write" as const,
      target: { rootId: "metadata" as const, relativePath: `Movie/file-${index}.txt` },
      content: { kind: "text" as const, data: `content-${index}` },
      replaceExisting: false,
    }));
    const firstTarget = path.join(test.metadataRoot, "Movie/file-1.txt");
    const secondTarget = path.join(test.metadataRoot, "Movie/file-2.txt");
    const fileSystem = await defaultFileSystem();
    const originalRename = fileSystem.rename;
    fileSystem.rename = async (source, target) => {
      await originalRename(source, target);
      if (target === firstTarget) writeFileSync(secondTarget, "foreign target");
    };

    await expect(
      commitPublishedMedia(test.plan, {
        resolveRoot: test.resolveRoot,
        journal: createMemoryPublicationJournal(),
        fileSystem,
        commit: () => undefined,
      }),
    ).rejects.toThrow("发布目标在提交前发生变化");
    await expect(stat(firstTarget)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(secondTarget, "utf8")).resolves.toBe("foreign target");
    await expect(residue(test.metadataRoot)).resolves.toEqual([]);
  });

  it("restores a replaced target when the part rename fails after the backup", async () => {
    const test = await fixture();
    test.plan.files[0].operations = [];
    test.plan.operations = test.plan.operations.filter((operation) => operation.kind === "write");
    test.plan.obsolete = [];
    await mkdir(path.dirname(test.nfo), { recursive: true });
    await writeFile(test.nfo, "original-nfo");
    await writeFile(test.poster, "original-poster");
    const writes = test.plan.operations.filter((operation) => operation.kind === "write");
    const nfo = writes[0];
    const poster = writes[1];
    if (!nfo || !poster) throw new Error("fixture artifacts are required");
    test.plan.operations = [nfo, poster];
    const fileSystem = await defaultFileSystem();
    const originalRename = fileSystem.rename;
    let renames = 0;
    fileSystem.rename = async (source, target) => {
      renames += 1;
      if (renames === 4) throw new Error("part rename failed after backup");
      await originalRename(source, target);
    };
    const journal = createMemoryPublicationJournal();
    await expect(
      commitPublishedMedia(test.plan, {
        resolveRoot: test.resolveRoot,
        journal,
        commit: () => undefined,
        fileSystem,
      }),
    ).rejects.toThrow("part rename failed after backup");
    await expect(readFile(test.nfo, "utf8")).resolves.toBe("original-nfo");
    await expect(readFile(test.poster, "utf8")).resolves.toBe("original-poster");
    expect(journal.listUnfinished()).toEqual([]);
    await expect(residue(test.metadataRoot)).resolves.toEqual([]);
  });

  it("preserves the backup, records a repair issue, and throws AggregateError when rollback fails", async () => {
    const test = await fixture();
    await mkdir(path.dirname(test.nfo), { recursive: true });
    await writeFile(test.nfo, "original-nfo");
    test.plan.files[0].operations = [];
    test.plan.operations = test.plan.operations.filter((operation) => operation.kind === "write");
    const nfo = test.plan.operations[0];
    if (!nfo) throw new Error("fixture nfo artifact is required");
    test.plan.operations = [nfo];
    test.plan.movieAssets = [];
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

  it("preserves committed files when cleanup and repair reporting fail", async () => {
    const test = await fixture();
    const fileSystem = await defaultFileSystem();
    const originalRm = fileSystem.rm;
    const originalRename = fileSystem.rename;
    fileSystem.rename = async (source, target) => {
      if (source === test.source) throw Object.assign(new Error("cross-device"), { code: "EXDEV" });
      await originalRename(source, target);
    };
    fileSystem.rm = async (filePath, options) => {
      if (filePath === test.source) throw new Error("source cleanup failed");
      await originalRm(filePath, options);
    };
    const repairIssues = {
      record: vi.fn(() => {
        throw new Error("repair record failed");
      }),
      resolve: vi.fn(() => undefined),
    };
    const published = await commitPublishedMedia(test.plan, {
      resolveRoot: test.resolveRoot,
      journal: createMemoryPublicationJournal(),
      repairIssues,
      fileSystem,
      commit: () => "committed",
    });
    expect(published.value).toBe("committed");
    expect(published.cleanupIssues.map((issue) => (issue as Error).message)).toEqual([
      "source cleanup failed",
      "repair record failed",
    ]);
    await expect(readFile(test.target, "utf8")).resolves.toBe("video");
    await expect(readFile(test.nfo, "utf8")).resolves.toBe("<movie/>");
  });

  it("rejects publication when the target appears after ownership is acquired", async () => {
    const test = await fixture();
    const journal = createMemoryPublicationJournal();
    const commit = vi.fn(() => undefined);

    const error = await commitPublishedMedia(test.plan, {
      resolveRoot: test.resolveRoot,
      journal,
      commit,
      acquireAll: () => {
        mkdirSync(path.dirname(test.target), { recursive: true });
        writeFileSync(test.target, "video");
        return () => undefined;
      },
    }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(PublicationConflictError);

    expect(commit).not.toHaveBeenCalled();
    expect(journal.listUnfinished()).toEqual([]);
    expect(existsSync(test.source)).toBe(true);
  });

  it("retains moved bytes at the target and obsolete assets until the database commit", async () => {
    const test = await fixture();
    const commit = vi.fn(() => {
      expect(existsSync(test.source)).toBe(false);
      expect(readFileSync(test.target, "utf8")).toBe("video");
      expect(readFileSync(test.obsolete, "utf8")).toBe("old");
      return "committed";
    });
    await expect(
      commitPublishedMedia(test.plan, {
        resolveRoot: test.resolveRoot,
        journal: createMemoryPublicationJournal(),
        commit,
      }),
    ).resolves.toEqual({ value: "committed", cleanupIssues: [] });
    expect(commit).toHaveBeenCalledOnce();
    await expect(stat(test.source)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(test.obsolete)).rejects.toMatchObject({ code: "ENOENT" });
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
    ).rejects.toThrow("Staged transfer size mismatch");
    expect(await readFile(test.source, "utf8")).toBe("video");
    await expect(stat(test.target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    "different-content",
    "same-size-subsecond-mtime",
  ] as const)("revalidates obsolete assets immediately before cleanup: %s", async (change) => {
    const test = await fixture();
    const originalObsolete = await stat(test.obsolete);
    const fileSystem = await defaultFileSystem();
    const originalRename = fileSystem.rename;
    fileSystem.rename = async (source, target) => {
      await originalRename(source, target);
      if (target !== test.poster) return;
      if (change === "different-content") {
        writeFileSync(test.obsolete, "foreign obsolete");
        return;
      }
      await writeFile(test.obsolete, "OLD");
      const changedAt = new Date(originalObsolete.mtimeMs + 100);
      await utimes(test.obsolete, changedAt, changedAt);
    };
    const journal = createMemoryPublicationJournal();
    const repairIssues = { record: vi.fn(() => undefined), resolve: vi.fn(() => undefined) };

    await expect(
      commitPublishedMedia(test.plan, {
        resolveRoot: test.resolveRoot,
        journal,
        repairIssues,
        fileSystem,
        commit: () => undefined,
      }),
    ).resolves.toEqual({ value: undefined, cleanupIssues: [expect.any(Error)] });
    await expect(readFile(test.obsolete, "utf8")).resolves.toBe(
      change === "different-content" ? "foreign obsolete" : "OLD",
    );
    expect(journal.listUnfinished()).toEqual([]);
    expect(repairIssues.record).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: test.plan.operationId,
        rootId: "metadata",
        relativePath: "old.jpg",
      }),
    );
  });

  it("rejects replaying a move without its source instead of inferring success from target size", async () => {
    const test = await fixture();
    const commit = vi.fn(() => ({ libraryItemId: "library-item-1" }));
    const options = { resolveRoot: test.resolveRoot, journal: createMemoryPublicationJournal(), commit };

    await expect(commitPublishedMedia(test.plan, options)).resolves.toEqual({
      value: { libraryItemId: "library-item-1" },
      cleanupIssues: [],
    });
    await expect(commitPublishedMedia(test.plan, options)).rejects.toThrow("Publication source is missing");
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("rejects a target that changes during staging", async () => {
    const test = await fixture();
    const fileSystem = await defaultFileSystem();
    const originalWriteFile = fileSystem.writeFile;
    fileSystem.writeFile = async (filePath, data, options) => {
      await originalWriteFile(filePath, data, options);
      if (filePath.endsWith(".part") && filePath.includes("movie.nfo")) {
        mkdirSync(path.dirname(test.target), { recursive: true });
        writeFileSync(test.target, "video");
      }
    };
    const commit = vi.fn(() => undefined);
    await expect(
      commitPublishedMedia(test.plan, {
        resolveRoot: test.resolveRoot,
        journal: createMemoryPublicationJournal(),
        commit,
        fileSystem,
      }),
    ).rejects.toBeInstanceOf(PublicationConflictError);
    expect(commit).not.toHaveBeenCalled();
    await expect(readFile(test.source, "utf8")).resolves.toBe("video");
  });

  it("preserves the original error when repair recording throws during rollback", async () => {
    const test = await fixture();
    await mkdir(path.dirname(test.nfo), { recursive: true });
    await writeFile(test.nfo, "original-nfo");
    test.plan.files[0].operations = [];
    test.plan.operations = test.plan.operations.filter((operation) => operation.kind === "write");
    const nfo = test.plan.operations[0];
    if (!nfo) throw new Error("fixture nfo artifact is required");
    test.plan.operations = [nfo];
    test.plan.movieAssets = [];
    test.plan.obsolete = [];
    const fileSystem = await defaultFileSystem();
    const originalRename = fileSystem.rename;
    fileSystem.rename = async (source, target) => {
      if (source.endsWith(".bak")) throw new Error("restore failed");
      await originalRename(source, target);
    };
    const repairIssues = {
      record: vi.fn(() => {
        throw new Error("repair record failed");
      }),
      resolve: vi.fn(() => undefined),
    };
    const error = await commitPublishedMedia(test.plan, {
      resolveRoot: test.resolveRoot,
      journal: createMemoryPublicationJournal(),
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
      "repair record failed",
    ]);
  });

  it("preserves the original error when rollback temp cleanup fails", async () => {
    const test = await fixture();
    const fileSystem = await defaultFileSystem();
    const originalRm = fileSystem.rm;
    fileSystem.rm = async (filePath, options) => {
      if (String(filePath).endsWith(".part")) throw new Error("temp cleanup failed");
      await originalRm(filePath, options);
    };
    const journal = createMemoryPublicationJournal();
    const error = await commitPublishedMedia(test.plan, {
      resolveRoot: test.resolveRoot,
      journal,
      fileSystem,
      commit: () => {
        throw new Error("database unavailable");
      },
    }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors.map((item) => (item as Error).message)).toEqual([
      "database unavailable",
      "temp cleanup failed",
    ]);
    expect(journal.listUnfinished()).toHaveLength(1);
    await expect(readFile(test.source, "utf8")).resolves.toBe("video");
  });

  it("preserves the original error when journal finish fails during rollback", async () => {
    const test = await fixture();
    const journal = createMemoryPublicationJournal();
    const originalFinish = journal.finish.bind(journal);
    journal.finish = () => {
      throw new Error("journal finish failed");
    };
    const error = await commitPublishedMedia(test.plan, {
      resolveRoot: test.resolveRoot,
      journal,
      commit: () => {
        throw new Error("database unavailable");
      },
    }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors.map((item) => (item as Error).message)).toEqual([
      "database unavailable",
      "journal finish failed",
    ]);
    originalFinish(test.plan.operationId);
  });
});
