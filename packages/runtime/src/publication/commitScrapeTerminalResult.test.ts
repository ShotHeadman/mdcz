import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CrawlerData, ScrapeResult } from "@mdcz/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commitScrapeTerminalResult } from "./commitScrapeTerminalResult";
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
});

const scrapeRuns = () => ({
  commitOutcome: vi.fn((input: { outcome: "failed" | "skipped"; attemptId: string; error?: string | null }) => ({
    id: `${input.outcome}-outcome`,
  })),
  commitSuccessOutcome: vi.fn(() => ({ outcomeId: "success-outcome", entryId: "entry-1" })),
});

const noFileTransitions = () => ({ failed: vi.fn(async () => undefined), succeeded: vi.fn(async () => undefined) });

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
    video: {
      source: { rootId: "input", relativePath: "movie.mp4" },
      target: { rootId: "output", relativePath: "ABC-001/movie.mp4" },
      size: 5,
    },
    artifacts: [
      { target: { rootId: "output", relativePath: "ABC-001/movie.nfo" }, content: { kind: "text", data: "<movie/>" } },
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
    plan,
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
      fileTransitions: { failed: failedTransition, succeeded: vi.fn() },
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
    expect(store.commitSuccessOutcome).not.toHaveBeenCalled();
    expect(failedTransition).toHaveBeenCalledOnce();
  });

  it("publishes a successful item and records nfo as null when it shares the output root", async () => {
    const test = await fixture();
    const store = scrapeRuns();
    const succeededTransition = vi.fn(async () => {
      expect(store.commitSuccessOutcome).toHaveBeenCalledOnce();
    });
    const committed = await commitScrapeTerminalResult({
      result: { ...baseResult("success"), crawlerData: crawlerData() },
      attemptId: "attempt-1",
      itemPath: "movie.mp4",
      success: {
        plan: test.plan,
        crawlerData: crawlerData(),
        identity: "ABC-001",
        nfo: { rootId: "output", relativePath: "ABC-001/movie.nfo" },
        size: 5,
        modifiedAt: null,
        uncensoredAmbiguous: false,
      },
      scrapeRuns: store,
      resolveRoot: test.resolveRoot,
      journal: createMemoryPublicationJournal(),
      fileTransitions: { failed: vi.fn(), succeeded: succeededTransition },
    });

    expect(committed).toMatchObject({ status: "success", resultId: "success-outcome" });
    expect(store.commitSuccessOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "success",
        nfoRootId: null,
        nfoRelativePath: "ABC-001/movie.nfo",
        outputRootId: "output",
        outputRelativePath: "ABC-001/movie.mp4",
        libraryEntry: expect.objectContaining({
          mediaIdentity: "ABC-001",
          thumbnailPath: "ABC-001/poster.jpg",
          assets: [
            { kind: "poster", uri: "ABC-001/poster.jpg", rootId: "output", relativePath: "ABC-001/poster.jpg" },
            { kind: "trailer", uri: "https://example.test/trailer.mp4" },
          ],
        }),
      }),
    );
    await expect(readFile(test.target, "utf8")).resolves.toBe("video");
    expect(succeededTransition).toHaveBeenCalledOnce();
  });

  it("treats committed-but-cleanup-failed publication as success", async () => {
    const test = await fixture();
    const store = scrapeRuns();
    const fs = await import("node:fs/promises");
    const fileSystem: PublicationFileSystem = {
      copyFile: fs.copyFile,
      mkdir: fs.mkdir,
      readFile: fs.readFile,
      rename: fs.rename,
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
        plan: test.plan,
        crawlerData: crawlerData(),
        identity: "ABC-001",
        nfo: { rootId: "metadata", relativePath: "ABC-001/movie.nfo" },
        size: 5,
        modifiedAt: null,
        uncensoredAmbiguous: true,
      },
      scrapeRuns: store,
      resolveRoot: test.resolveRoot,
      journal: createMemoryPublicationJournal(),
      fileSystem,
      fileTransitions: noFileTransitions(),
    });

    expect(committed).toMatchObject({ status: "success", resultId: "success-outcome" });
    expect(store.commitOutcome).not.toHaveBeenCalled();
    expect(store.commitSuccessOutcome).toHaveBeenCalledOnce();
    await expect(readFile(test.target, "utf8")).resolves.toBe("video");
  });

  it("writes a failed outcome when publication throws before commit", async () => {
    const test = await fixture();
    const store = scrapeRuns();
    store.commitSuccessOutcome.mockImplementation(() => {
      throw new Error("library constraint failed");
    });
    const failedTransition = vi.fn(async () => undefined);

    const committed = await commitScrapeTerminalResult({
      result: { ...baseResult("success"), crawlerData: crawlerData() },
      attemptId: "attempt-1",
      itemPath: "movie.mp4",
      success: {
        plan: test.plan,
        crawlerData: crawlerData(),
        identity: "ABC-001",
        nfo: null,
        size: 5,
        modifiedAt: null,
        uncensoredAmbiguous: false,
      },
      scrapeRuns: store,
      resolveRoot: test.resolveRoot,
      journal: createMemoryPublicationJournal(),
      fileTransitions: { failed: failedTransition, succeeded: vi.fn() },
    });

    expect(committed.status).toBe("failed");
    expect(committed.error).toContain("library constraint failed");
    expect(store.commitOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failed", attemptId: "attempt-1" }),
    );
    expect(failedTransition).toHaveBeenCalledOnce();
  });

  it("aggregates publication and fallback-write failures", async () => {
    const test = await fixture();
    const store = scrapeRuns();
    store.commitSuccessOutcome.mockImplementation(() => {
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
        success: {
          plan: test.plan,
          crawlerData: crawlerData(),
          identity: "ABC-001",
          nfo: null,
          size: 5,
          modifiedAt: null,
          uncensoredAmbiguous: false,
        },
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
