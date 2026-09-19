import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MoveOutput } from "./MoveOutput";
import { createMemoryPublicationJournal } from "./memoryJournal";
import { outputFileSystem } from "./outputFileSystem";

const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const fixture = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "mdcz-move-output-"));
  directories.push(directory);
  const sourcePath = path.join(directory, "source.mp4");
  const targetPath = path.join(directory, "library", "target.mp4");
  await writeFile(sourcePath, "video");
  const observed = await fs.stat(sourcePath);
  return {
    directory,
    sourcePath,
    targetPath,
    move: {
      source: { rootId: "root", relativePath: "source.mp4" },
      target: { rootId: "root", relativePath: "library/target.mp4" },
      sourcePath,
      targetPath,
      size: observed.size,
      mtimeMs: observed.mtimeMs,
    },
  };
};

describe("MoveOutput", () => {
  it("rolls a same-filesystem move back when the database commit fails", async () => {
    const test = await fixture();
    await expect(
      new MoveOutput().install({
        operationId: "move",
        operationType: "scrape",
        moves: [test.move],
        artifacts: [],
        journal: createMemoryPublicationJournal(),
        commit: () => {
          throw new Error("commit failed");
        },
      }),
    ).rejects.toThrow("commit failed");
    await expect(readFile(test.sourcePath, "utf8")).resolves.toBe("video");
    await expect(readFile(test.targetPath)).rejects.toMatchObject({ code: "ENOENT" });

    const rewritten = await fixture();
    const rewrittenJournal = createMemoryPublicationJournal();
    let recordedManifestTemporaryPath = "";
    await expect(
      new MoveOutput().install({
        operationId: "rewrite",
        operationType: "scrape",
        moves: [{ ...rewritten.move, rewrittenContent: "rewritten" }],
        artifacts: [],
        journal: rewrittenJournal,
        commit: () => {
          expect(existsSync(rewritten.sourcePath)).toBe(true);
          const unfinished = rewrittenJournal.listUnfinished();
          recordedManifestTemporaryPath = unfinished[0]?.manifest.entries[0]?.temporaryPath ?? "";
          throw new Error("commit failed");
        },
      }),
    ).rejects.toThrow("commit failed");
    expect(recordedManifestTemporaryPath.startsWith("library/")).toBe(true);
    expect(recordedManifestTemporaryPath.endsWith(".part.rewrite.part")).toBe(true);
    await expect(readFile(rewritten.sourcePath, "utf8")).resolves.toBe("video");
    await expect(readFile(rewritten.targetPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(rewrittenJournal.listUnfinished()).toEqual([]);
  });

  it("keeps the cross-device source through commit and deletes it afterward", async () => {
    const test = await fixture();
    const rename = vi.fn(async (source: string, target: string) => {
      if (source === test.sourcePath) throw Object.assign(new Error("cross device"), { code: "EXDEV" });
      await fs.rename(source, target);
    });
    const commit = vi.fn(() => {
      expect(existsSync(test.sourcePath)).toBe(true);
      return "committed";
    });
    const result = await new MoveOutput({ ...outputFileSystem, rename }).install({
      operationId: "move",
      operationType: "scrape",
      moves: [test.move],
      artifacts: [],
      journal: createMemoryPublicationJournal(),
      commit,
    });
    expect(result.value).toBe("committed");
    expect(commit).toHaveBeenCalledOnce();
    await expect(readFile(test.targetPath, "utf8")).resolves.toBe("video");
    await expect(readFile(test.sourcePath)).rejects.toMatchObject({ code: "ENOENT" });

    const failedCleanup = await fixture();
    const failedCleanupJournal = createMemoryPublicationJournal();
    const repairIssues = { record: vi.fn(), resolve: vi.fn() };
    const failedRename = vi.fn(async (source: string, target: string) => {
      if (source === failedCleanup.sourcePath) throw Object.assign(new Error("cross device"), { code: "EXDEV" });
      await fs.rename(source, target);
    });
    const remove: typeof outputFileSystem.rm = async (target, options) => {
      if (target === failedCleanup.sourcePath) throw new Error("source is locked");
      await fs.rm(target, options);
    };
    const failedResult = await new MoveOutput({ ...outputFileSystem, rename: failedRename, rm: remove }).install({
      operationId: "cleanup-failure",
      operationType: "scrape",
      moves: [failedCleanup.move],
      artifacts: [],
      journal: failedCleanupJournal,
      repairIssues,
      commit: () => "committed",
    });
    expect(failedResult.cleanupIssues).toHaveLength(1);
    expect(failedCleanupJournal.listUnfinished()).toMatchObject([{ state: "committed" }]);
    expect(repairIssues.record).toHaveBeenCalledWith({
      operationId: "cleanup-failure",
      operationType: "scrape",
      rootId: failedCleanup.move.target.rootId,
      relativePath: failedCleanup.move.target.relativePath,
      errorMessage: "source is locked",
    });
    await expect(readFile(failedCleanup.sourcePath, "utf8")).resolves.toBe("video");
    await expect(readFile(failedCleanup.targetPath, "utf8")).resolves.toBe("video");
  });

  it("rejects an occupied media destination before mutation", async () => {
    const test = await fixture();
    await fs.mkdir(path.dirname(test.targetPath), { recursive: true });
    await writeFile(test.targetPath, "existing");
    await expect(
      new MoveOutput().install({
        operationId: "move",
        operationType: "scrape",
        moves: [test.move],
        artifacts: [],
        journal: createMemoryPublicationJournal(),
        commit: () => undefined,
      }),
    ).rejects.toThrow("目标已存在");
    await expect(readFile(test.sourcePath, "utf8")).resolves.toBe("video");
    await expect(readFile(test.targetPath, "utf8")).resolves.toBe("existing");
  });
});
