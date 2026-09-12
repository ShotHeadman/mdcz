import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { CrawlerData, ScrapeResult } from "@mdcz/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commitScrapeTerminalResults, type ScrapeTerminalGroupItem } from "./commitScrapeTerminalResult";
import { PublicationConflictError } from "./conflicts";
import { createMemoryPublicationJournal } from "./memoryJournal";
import type { PublicationFileSystem, PublicationPlan } from "./types";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (directory) => await rm(directory, { recursive: true, force: true })),
  );
});

const crawlerData = (): CrawlerData => ({
  title: "Movie",
  number: "ABC-001",
  actors: ["Actor A"],
  genres: [],
  scene_images: [],
});

const baseResult = (status: ScrapeResult["status"]): ScrapeResult => ({
  fileId: "item-1",
  rootId: "input",
  relativePath: "movie.mp4",
  fileName: "movie.mp4",
  status,
  assets: [],
  output: status === "success" ? { rootId: "output", relativePath: "ABC-001/movie.mp4" } : undefined,
});

const scrapeRuns = () => ({
  commitOutcome: vi.fn((input: { outcome: "failed" | "skipped"; attemptId: string; error?: string | null }) => ({
    id: `${input.outcome}-outcome`,
  })),
  commitSuccessOutcomes: vi.fn((inputs: readonly unknown[]) =>
    inputs.map((_, index) => ({
      outcomeId: index === 0 ? "success-outcome" : `success-outcome-${index + 1}`,
      entryId: "entry-1",
    })),
  ),
});

const noFileTransitions = () => ({ failed: vi.fn(async () => undefined) });

const commitScrapeTerminalResult = async (
  input: Omit<Parameters<typeof commitScrapeTerminalResults>[0], "items"> &
    ScrapeTerminalGroupItem & { success?: Awaited<ReturnType<typeof fixture>>["success"] },
): Promise<ScrapeResult> => {
  const item = {
    ...input,
    result: {
      ...input.result,
      ...(input.success
        ? {
            publicationPlan: input.success.plan,
            crawlerData: input.success.crawlerData,
            nfo: input.success.nfo ?? undefined,
            uncensoredAmbiguous: input.success.uncensoredAmbiguous,
          }
        : {}),
    },
  };
  const [result] = await commitScrapeTerminalResults({ ...input, items: [item] });
  if (!result) throw new Error("Test scrape terminal group omitted its item");
  return result;
};

const fixture = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "mdcz-scrape-commit-"));
  directories.push(directory);
  const inputRoot = path.join(directory, "input");
  const outputRoot = path.join(directory, "output");
  await Promise.all([mkdir(inputRoot), mkdir(outputRoot)]);
  const source = path.join(inputRoot, "movie.mp4");
  await writeFile(source, "video");
  const plan: PublicationPlan = {
    operationId: "run:attempt",
    operationType: "scrape",
    media: [
      {
        source: { rootId: "input", relativePath: "movie.mp4" },
        target: { rootId: "output", relativePath: "ABC-001/movie.mp4" },
        size: 5,
      },
    ],
    videos: [
      {
        source: { rootId: "input", relativePath: "movie.mp4" },
        target: { rootId: "output", relativePath: "ABC-001/movie.mp4" },
        size: 5,
      },
    ],
    artifacts: [
      { target: { rootId: "output", relativePath: "ABC-001/movie.nfo" }, content: { kind: "text", data: "<movie/>" } },
      { target: { rootId: "output", relativePath: "ABC-001/poster.jpg" }, content: { kind: "text", data: "poster" } },
    ],
    assets: [
      { type: "local", kind: "poster", file: { rootId: "output", relativePath: "ABC-001/poster.jpg" } },
      { type: "remote", kind: "trailer", url: "https://example.test/trailer.mp4" },
    ],
    obsolete: [],
  };
  const roots = new Map([
    ["input", { id: "input", hostPath: inputRoot }],
    ["output", { id: "output", hostPath: outputRoot }],
  ]);
  return {
    success: {
      plan,
      crawlerData: crawlerData(),
      identity: "ABC-001",
      nfo: null as RootFileRef | null,
      uncensoredAmbiguous: false,
    },
    source,
    target: path.join(outputRoot, "ABC-001/movie.mp4"),
    resolveRoot: async (rootId: string) => {
      const root = roots.get(rootId);
      if (!root) throw new Error(`missing root ${rootId}`);
      return root;
    },
  };
};

describe("commitScrapeTerminalResult", () => {
  it.each([
    "video",
    "unknown-output",
    "other-owner",
  ])("does not invoke failure movement on publication conflict: %s", async (scenario) => {
    const test = await fixture();
    const store = scrapeRuns();
    const transitions = noFileTransitions();
    await mkdir(path.dirname(test.target), { recursive: true });
    const conflictPath = scenario === "video" ? test.target : path.join(path.dirname(test.target), "movie.nfo");
    await writeFile(conflictPath, "existing bytes");
    const nfo = { rootId: "output", relativePath: "ABC-001/movie.nfo" };
    test.success.plan.replaceExistingTargets = [nfo];
    const outputs = {
      publicationSnapshot: () => ({
        files: [],
        assets:
          scenario === "other-owner"
            ? [{ ...nfo, itemId: "other", fileId: null, kind: "nfo", published: true, historical: false }]
            : [],
      }),
      registerPublishedOutputs: vi.fn(),
      releaseOutputReferences: vi.fn(),
    };
    const journal = createMemoryPublicationJournal();
    await expect(
      commitScrapeTerminalResult({
        result: { ...baseResult("success"), crawlerData: crawlerData() },
        attemptId: "attempt-1",
        itemPath: "movie.mp4",
        success: test.success,
        scrapeRuns: store,
        resolveRoot: test.resolveRoot,
        journal,
        outputs,
        fileTransitions: transitions,
      }),
    ).rejects.toBeInstanceOf(PublicationConflictError);
    expect(transitions.failed).not.toHaveBeenCalled();
    expect(store.commitOutcome).not.toHaveBeenCalled();
    expect(store.commitSuccessOutcomes).not.toHaveBeenCalled();
    expect(await readFile(test.source, "utf8")).toBe("video");
    expect(await readFile(conflictPath, "utf8")).toBe("existing bytes");
    if (scenario === "video")
      await expect(readFile(path.join(path.dirname(test.target), "movie.nfo"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    expect(journal.listUnfinished()).toEqual([]);
  });
  it("persists failed and skipped outcomes without publication", async () => {
    const store = scrapeRuns();
    const failedTransition = vi.fn(async () => undefined);
    const failed = await commitScrapeTerminalResult({
      result: { ...baseResult("failed"), error: "  boom  " },
      attemptId: "attempt-1",
      itemPath: "movie.mp4",
      scrapeRuns: store,
      resolveRoot: async () => ({ id: "input", hostPath: "/tmp" }),
      journal: createMemoryPublicationJournal(),
      fileTransitions: { failed: failedTransition },
    });
    const skipped = await commitScrapeTerminalResult({
      result: baseResult("skipped"),
      attemptId: "attempt-2",
      itemPath: "movie.mp4",
      scrapeRuns: store,
      resolveRoot: async () => ({ id: "input", hostPath: "/tmp" }),
      journal: createMemoryPublicationJournal(),
      fileTransitions: noFileTransitions(),
    });

    expect(failed).toMatchObject({ status: "failed", resultId: "failed-outcome", error: "boom" });
    expect(skipped).toMatchObject({ status: "skipped", resultId: "skipped-outcome" });
    expect(store.commitOutcome).toHaveBeenCalledWith({
      outcome: "failed",
      attemptId: "attempt-1",
      error: "boom",
    });
    expect(store.commitOutcome).toHaveBeenCalledWith({
      outcome: "skipped",
      attemptId: "attempt-2",
      error: null,
    });
    expect(store.commitSuccessOutcomes).not.toHaveBeenCalled();
    expect(failedTransition).toHaveBeenCalledOnce();
  });

  it("publishes a successful item and records nfo as null when it shares the output root", async () => {
    const test = await fixture();
    const store = scrapeRuns();
    const committed = await commitScrapeTerminalResult({
      result: { ...baseResult("success"), crawlerData: crawlerData() },
      attemptId: "attempt-1",
      itemPath: "movie.mp4",
      success: {
        ...test.success,
        nfo: { rootId: "output", relativePath: "ABC-001/movie.nfo" },
      },
      scrapeRuns: store,
      resolveRoot: test.resolveRoot,
      journal: createMemoryPublicationJournal(),
      fileTransitions: { failed: vi.fn() },
    });

    expect(committed).toMatchObject({ status: "success", resultId: "success-outcome" });
    expect(store.commitSuccessOutcomes).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          outcome: "success",
          nfoRootId: null,
          nfoRelativePath: "ABC-001/movie.nfo",
          outputRootId: "output",
          outputRelativePath: "ABC-001/movie.mp4",
          libraryEntry: expect.objectContaining({
            assets: [
              { kind: "poster", uri: "ABC-001/poster.jpg", rootId: "output", relativePath: "ABC-001/poster.jpg" },
              { kind: "trailer", uri: "https://example.test/trailer.mp4" },
            ],
          }),
        }),
      ],
      expect.objectContaining({ mediaIdentity: "ABC-001" }),
    );
    await expect(readFile(test.target, "utf8")).resolves.toBe("video");
  });

  it.each([
    true,
    false,
  ])("adds a later multipart file when the registered sibling is available: %s", async (siblingAvailable) => {
    const test = await fixture();
    const store = scrapeRuns();
    const directory = path.dirname(test.source);
    const source = path.join(directory, "ABC-001-CD2.mp4");
    await writeFile(source, "part2");
    const targetRef = { rootId: "output", relativePath: "ABC-001/ABC-001-CD2.mp4" };
    const sourceRef = { rootId: "input", relativePath: "ABC-001-CD2.mp4" };
    const existingFile = {
      rootId: "output",
      relativePath: "ABC-001/ABC-001-CD1.mp4",
      itemId: "existing-item",
      fileId: "existing-file",
      mediaIdentity: "abc-001",
      size: 5,
    };
    const existingAssets = [
      {
        rootId: "output",
        relativePath: "ABC-001/movie.nfo",
        itemId: "existing-item",
        fileId: null,
        kind: "nfo",
        published: true,
        historical: false,
      },
      {
        rootId: "output",
        relativePath: "ABC-001/poster.jpg",
        itemId: "existing-item",
        fileId: null,
        kind: "poster",
        published: true,
        historical: false,
      },
    ];
    await mkdir(path.dirname(test.target), { recursive: true });
    await Promise.all([
      ...(siblingAvailable ? [writeFile(path.join(path.dirname(test.target), "ABC-001-CD1.mp4"), "part1")] : []),
      writeFile(path.join(path.dirname(test.target), "movie.nfo"), "<old/>"),
      writeFile(path.join(path.dirname(test.target), "poster.jpg"), "old"),
    ]);
    test.success.plan.media = [{ source: sourceRef, target: targetRef, size: 5 }];
    test.success.plan.videos = [{ source: sourceRef, target: targetRef, size: 5 }];
    const outputs = {
      publicationSnapshot: vi.fn(() => ({ files: [existingFile], assets: existingAssets })),
      registerPublishedOutputs: vi.fn(),
      releaseOutputReferences: vi.fn(),
    };

    await commitScrapeTerminalResult({
      result: {
        ...baseResult("success"),
        fileId: "part-2",
        relativePath: sourceRef.relativePath,
        fileName: sourceRef.relativePath,
        output: targetRef,
        crawlerData: crawlerData(),
      },
      attemptId: "attempt-2",
      itemPath: sourceRef.relativePath,
      success: test.success,
      scrapeRuns: store,
      resolveRoot: test.resolveRoot,
      journal: createMemoryPublicationJournal(),
      outputs,
      fileTransitions: noFileTransitions(),
    });

    expect(store.commitSuccessOutcomes).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          libraryEntry: expect.objectContaining({ fileId: undefined, partNumber: 2 }),
        }),
      ],
      expect.objectContaining({ id: "existing-item" }),
    );
    const sibling = readFile(path.join(path.dirname(test.target), "ABC-001-CD1.mp4"), "utf8");
    if (siblingAvailable) await expect(sibling).resolves.toBe("part1");
    else await expect(sibling).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(path.dirname(test.target), "ABC-001-CD2.mp4"), "utf8")).resolves.toBe("part2");
  });

  it("treats committed-but-cleanup-failed publication as success", async () => {
    const test = await fixture();
    const store = scrapeRuns();
    const fs = await import("node:fs/promises");
    const fileSystem: PublicationFileSystem = {
      copyFile: fs.copyFile,
      mkdir: fs.mkdir,
      readFile: fs.readFile,
      rename: async (source, target) => {
        if (source === test.source) throw Object.assign(new Error("cross-device"), { code: "EXDEV" });
        await fs.rename(source, target);
      },
      rm: async (filePath, options) => {
        if (filePath === test.source) throw new Error("source cleanup failed");
        await fs.rm(filePath, options);
      },
      stat: fs.stat,
      statfs: fs.statfs,
      writeFile: fs.writeFile,
    };

    const committed = await commitScrapeTerminalResult({
      result: { ...baseResult("success"), crawlerData: crawlerData() },
      attemptId: "attempt-1",
      itemPath: "movie.mp4",
      success: {
        ...test.success,
        nfo: { rootId: "metadata", relativePath: "ABC-001/movie.nfo" },
        uncensoredAmbiguous: true,
      },
      scrapeRuns: store,
      resolveRoot: test.resolveRoot,
      journal: createMemoryPublicationJournal(),
      fileSystem,
      fileTransitions: noFileTransitions(),
    });

    expect(committed).toMatchObject({
      status: "success",
      resultId: "success-outcome",
      error: expect.stringContaining("媒体库已提交，但清理失败"),
    });
    expect(committed.error).toContain("。请重新扫描");
    expect(store.commitOutcome).not.toHaveBeenCalled();
    expect(store.commitSuccessOutcomes).toHaveBeenCalledOnce();
    await expect(readFile(test.target, "utf8")).resolves.toBe("video");
  });

  it("writes a failed outcome when publication throws before commit", async () => {
    const test = await fixture();
    const store = scrapeRuns();
    store.commitSuccessOutcomes.mockImplementation(() => {
      throw new Error("library constraint failed");
    });
    const failedTransition = vi.fn(async () => undefined);

    const committed = await commitScrapeTerminalResult({
      result: { ...baseResult("success"), crawlerData: crawlerData() },
      attemptId: "attempt-1",
      itemPath: "movie.mp4",
      success: test.success,
      scrapeRuns: store,
      resolveRoot: test.resolveRoot,
      journal: createMemoryPublicationJournal(),
      fileTransitions: { failed: failedTransition },
    });

    expect(committed.status).toBe("failed");
    expect(committed.error).toContain("library constraint failed");
    expect(committed.error).toContain("。请重新扫描");
    expect(committed.error).not.toContain("以磁盘实际状态重新协调");
    expect(store.commitOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failed", attemptId: "attempt-1" }),
    );
    expect(failedTransition).toHaveBeenCalledOnce();
  });

  it("records every grouped failure when a failure transition also throws", async () => {
    const test = await fixture();
    const store = scrapeRuns();
    store.commitSuccessOutcomes.mockImplementation(() => {
      throw new Error("library constraint failed");
    });
    const firstTransition = vi.fn(async () => {
      throw new Error("failure move failed");
    });
    const secondTransition = vi.fn(async () => undefined);
    const result = { ...baseResult("success"), crawlerData: crawlerData(), publicationPlan: test.success.plan };

    const committed = await commitScrapeTerminalResults({
      items: [
        {
          result,
          attemptId: "attempt-1",
          itemPath: "movie.mp4",
          fileTransitions: { failed: firstTransition },
        },
        {
          result: { ...result, fileId: "item-2" },
          attemptId: "attempt-2",
          itemPath: "movie-part-2.mp4",
          fileTransitions: { failed: secondTransition },
        },
      ],
      scrapeRuns: store,
      resolveRoot: test.resolveRoot,
      journal: createMemoryPublicationJournal(),
    });

    expect(committed).toHaveLength(2);
    expect(committed[0]).toMatchObject({
      status: "failed",
      resultId: "failed-outcome",
      error: expect.stringContaining("失败文件移动失败：failure move failed"),
    });
    expect(committed[1]).toMatchObject({ status: "failed", resultId: "failed-outcome" });
    expect(store.commitOutcome).toHaveBeenCalledTimes(2);
    expect(store.commitOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ attemptId: "attempt-2", error: expect.stringContaining("library constraint failed") }),
    );
    expect(firstTransition).toHaveBeenCalledOnce();
    expect(secondTransition).toHaveBeenCalledOnce();
  });

  it("aggregates publication and fallback-write failures", async () => {
    const test = await fixture();
    const store = scrapeRuns();
    store.commitSuccessOutcomes.mockImplementation(() => {
      throw new Error("library constraint failed");
    });
    store.commitOutcome.mockImplementation(() => {
      throw new Error("outcome write failed");
    });

    await expect(
      commitScrapeTerminalResult({
        result: { ...baseResult("success"), crawlerData: crawlerData() },
        attemptId: "attempt-1",
        itemPath: "movie.mp4",
        success: test.success,
        scrapeRuns: store,
        resolveRoot: test.resolveRoot,
        journal: createMemoryPublicationJournal(),
        fileTransitions: noFileTransitions(),
      }),
    ).rejects.toMatchObject({
      name: "AggregateError",
      message: expect.stringContaining("library constraint failed"),
    });
  });
});
