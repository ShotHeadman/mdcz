import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CrawlerData } from "@mdcz/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseFileInfo } from "../scrape/utils/number";
import { commitScrapeTerminalResults, type ScrapeSuccessOutcomeCommitInput } from "./commitScrapeTerminalResult";
import { PublicationConflictError } from "./conflicts";
import { createMemoryPublicationJournal } from "./memoryJournal";
import { preparePublicationPlan } from "./preparePublicationPlan";
import { toRootFileRef } from "./publicationPlan";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const crawlerData: CrawlerData = {
  title: "Movie",
  number: "ABC-001",
  actors: ["Actor A"],
  genres: [],
  scene_images: [],
  trailer_url: "https://example.test/trailer.mp4",
};

const scrapeRuns = () => ({
  commitOutcome: vi.fn((input: { outcome: "failed" | "skipped"; attemptId: string; error?: string | null }) => ({
    id: `${input.outcome}-outcome`,
  })),
  commitSuccessOutcomes: vi.fn((inputs: readonly ScrapeSuccessOutcomeCommitInput[], movie: { id: string }) =>
    inputs.map((input, index) => ({
      attemptId: input.attemptId,
      fileId: input.libraryEntry.fileId,
      outcomeId: `success-outcome-${index + 1}`,
      entryId: movie.id,
    })),
  ),
});

const fixture = async (names = ["movie.mp4"], nfoRootId = "output") => {
  const directory = await mkdtemp(path.join(tmpdir(), "mdcz-scrape-commit-"));
  directories.push(directory);
  const roots = ["input", "output", "metadata", "staging"].map((id) => ({ id, hostPath: path.join(directory, id) }));
  await Promise.all(roots.map((root) => mkdir(root.hostPath)));
  const resolveRoot = async (rootId: string) => {
    const root = roots.find((root) => root.id === rootId);
    if (!root) throw new Error(`Missing root ${rootId}`);
    return root;
  };
  const sourcePaths = names.map((name) => path.join(directory, "input", name));
  const output = path.join(directory, "output", "ABC-001");
  const nfoPath = path.join(directory, nfoRootId, "ABC-001", "movie.nfo");
  const poster = path.join(directory, "staging", "poster.jpg");
  await Promise.all([...sourcePaths.map((source) => writeFile(source, "video")), writeFile(poster, "poster")]);
  const prepared = await preparePublicationPlan({
    operationId: "run:attempt",
    operationType: "scrape",
    roots,
    identity: {
      movieId: randomUUID(),
      expected: { files: [], assets: [] },
      members: sourcePaths.map((sourceVideoPath, index) => ({
        source: toRootFileRef(sourceVideoPath, roots),
        fileId: randomUUID(),
        scrape: {
          itemId: `item-${index + 1}`,
          attemptId: `attempt-${index + 1}`,
          identity: { rootId: "input", relativePath: names[index], fileName: names[index] },
          fileInfo: parseFileInfo(sourceVideoPath),
          uncensoredAmbiguous: false,
        },
        assetLayout: {
          staged: new Map([["poster.jpg", path.join(path.dirname(nfoPath), "poster.jpg")]]),
          retained: new Map(),
        },
        layout: {
          mode: "move" as const,
          sourceVideoPath,
          targetVideoPath: path.join(output, names[index]),
          outputDir: output,
          metadataDir: path.dirname(nfoPath),
          existingMetadataDir: path.dirname(sourceVideoPath),
          nfoPath,
          sidecars: [],
        },
      })),
    },
    stagingDir: path.join(directory, "staging"),
    downloadedAssets: { downloaded: [poster], sceneImages: [], poster },
    actorPhotoPaths: [],
    nfoNaming: "movie",
    remoteData: crawlerData,
    scrape: { crawlerData, sources: {} },
    writeNfo: async (_, write) => {
      await write(nfoPath, "<movie/>");
      return nfoPath;
    },
  });
  if (!prepared.plan) throw new Error("expected publication plan");
  return { plan: prepared.plan, sourcePaths, output, nfoPath, resolveRoot };
};

describe("commitScrapeTerminalResults", () => {
  it("rejects publication conflicts without writing a terminal outcome", async () => {
    const test = await fixture();
    const store = scrapeRuns();
    await mkdir(test.output, { recursive: true });
    const conflictPath = path.join(test.output, "movie.mp4");
    await writeFile(conflictPath, "existing bytes");
    const journal = createMemoryPublicationJournal();
    await expect(
      commitScrapeTerminalResults({
        items: [],
        publicationPlan: test.plan,
        scrapeRuns: store,
        resolveRoot: test.resolveRoot,
        journal,
      }),
    ).rejects.toBeInstanceOf(PublicationConflictError);
    expect(store.commitOutcome).not.toHaveBeenCalled();
    expect(store.commitSuccessOutcomes).not.toHaveBeenCalled();
    expect(await readFile(test.sourcePaths[0], "utf8")).toBe("video");
    expect(await readFile(conflictPath, "utf8")).toBe("existing bytes");
    await expect(readFile(test.nfoPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(journal.listUnfinished()).toEqual([]);
  });

  it("persists failed and skipped outcomes without publication", async () => {
    const store = scrapeRuns();
    const base = { fileId: "item-1", rootId: "input", relativePath: "movie.mp4", fileName: "movie", assets: [] };
    const committed = await commitScrapeTerminalResults({
      items: [
        { attemptId: "attempt-1", result: { ...base, status: "failed", error: "  boom  " } },
        { attemptId: "attempt-2", result: { ...base, fileId: "item-2", status: "skipped" } },
      ],
      scrapeRuns: store,
      resolveRoot: async () => ({ id: "input", hostPath: "/tmp" }),
      journal: createMemoryPublicationJournal(),
    });
    expect(committed).toMatchObject([
      { status: "failed", resultId: "failed-outcome", error: "boom" },
      { status: "skipped", resultId: "skipped-outcome" },
    ]);
    expect(store.commitOutcome).toHaveBeenCalledWith({ outcome: "failed", attemptId: "attempt-1", error: "boom" });
    expect(store.commitOutcome).toHaveBeenCalledWith({ outcome: "skipped", attemptId: "attempt-2", error: null });
    expect(store.commitSuccessOutcomes).not.toHaveBeenCalled();
  });

  it.each([
    "output",
    "metadata",
  ])("publishes a group and returns movie assets with an NFO in the %s root", async (nfoRootId) => {
    const test = await fixture(["ABC-001-CD1.mp4", "ABC-001-CD2.mp4"], nfoRootId);
    const store = scrapeRuns();
    const committed = await commitScrapeTerminalResults({
      items: [],
      publicationPlan: test.plan,
      scrapeRuns: store,
      resolveRoot: test.resolveRoot,
      journal: createMemoryPublicationJournal(),
    });
    expect(store.commitSuccessOutcomes).toHaveBeenCalledOnce();
    const [outcomes, movie] = store.commitSuccessOutcomes.mock.calls[0];
    expect(movie).toMatchObject({ id: test.plan.movieId, mediaIdentity: "ABC-001" });
    expect(outcomes.map((outcome) => outcome.libraryEntry)).toMatchObject([
      { partNumber: 1, assets: [] },
      { partNumber: 2, assets: [] },
    ]);
    expect(outcomes.every((outcome) => outcome.nfoRootId === (nfoRootId === "output" ? null : "metadata"))).toBe(true);
    expect(outcomes.every((outcome) => outcome.nfoRelativePath === "ABC-001/movie.nfo")).toBe(true);
    expect(movie).toHaveProperty("assets", [
      {
        kind: "poster",
        uri: "ABC-001/poster.jpg",
        rootId: nfoRootId,
        relativePath: "ABC-001/poster.jpg",
        published: true,
      },
      { kind: "trailer", uri: "https://example.test/trailer.mp4" },
      { kind: "nfo", uri: "ABC-001/movie.nfo", rootId: nfoRootId, relativePath: "ABC-001/movie.nfo", published: true },
    ]);
    for (const [index, result] of committed.entries()) {
      expect(result).toMatchObject({ status: "success", resultId: `success-outcome-${index + 1}` });
      expect(result.assets).toEqual([
        { type: "local", kind: "poster", file: { rootId: nfoRootId, relativePath: "ABC-001/poster.jpg" } },
        { type: "remote", kind: "trailer", url: "https://example.test/trailer.mp4" },
        { type: "local", kind: "nfo", file: { rootId: nfoRootId, relativePath: "ABC-001/movie.nfo" } },
      ]);
      expect(await readFile(path.join(test.output, path.basename(test.sourcePaths[index])), "utf8")).toBe("video");
      await expect(readFile(test.sourcePaths[index])).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it.each([
    true,
    false,
  ])("adds a multipart file without changing its registered sibling (available: %s)", async (siblingAvailable) => {
    const test = await fixture(["ABC-001-CD2.mp4"]);
    const store = scrapeRuns();
    const sibling = path.join(test.output, "ABC-001-CD1.mp4");
    await mkdir(test.output, { recursive: true });
    await Promise.all([
      ...(siblingAvailable ? [writeFile(sibling, "part1")] : []),
      writeFile(test.nfoPath, "<old/>"),
      writeFile(path.join(test.output, "poster.jpg"), "old"),
    ]);
    const snapshot = {
      files: [
        {
          rootId: "output",
          relativePath: "ABC-001/ABC-001-CD1.mp4",
          itemId: "existing-item",
          fileId: "existing-file",
          mediaIdentity: "abc-001",
          size: 5,
        },
      ],
      assets: ["nfo", "poster"].map((kind) => ({
        rootId: "output",
        relativePath: `ABC-001/${kind === "nfo" ? "movie.nfo" : "poster.jpg"}`,
        itemId: "existing-item",
        fileId: null,
        kind,
        published: true,
        historical: false,
      })),
    };
    Object.assign(test.plan, {
      movieId: "existing-item",
      expected: snapshot,
      operations: [],
    });
    await commitScrapeTerminalResults({
      items: [],
      publicationPlan: test.plan,
      scrapeRuns: store,
      resolveRoot: test.resolveRoot,
      journal: createMemoryPublicationJournal(),
      outputs: { publicationRoots: () => [], publicationSnapshot: () => snapshot },
    });
    expect(store.commitSuccessOutcomes).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          libraryEntry: expect.objectContaining({ fileId: expect.any(String), partNumber: 2 }),
        }),
      ],
      expect.objectContaining({ id: "existing-item" }),
    );
    if (siblingAvailable) expect(await readFile(sibling, "utf8")).toBe("part1");
    else await expect(readFile(sibling)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(test.output, "ABC-001-CD2.mp4"), "utf8")).toBe("video");
  });

  it("preserves successful outcomes when committed publication cleanup fails", async () => {
    const test = await fixture(["movie.mp4"], "metadata");
    const store = scrapeRuns();
    const journal = createMemoryPublicationJournal();
    journal.finish = () => {
      throw new Error("journal cleanup failed");
    };
    const committed = await commitScrapeTerminalResults({
      items: [],
      publicationPlan: test.plan,
      scrapeRuns: store,
      resolveRoot: test.resolveRoot,
      journal,
    });
    expect(committed).toMatchObject([
      { status: "success", resultId: "success-outcome-1", error: expect.stringContaining("媒体库已提交，但清理失败") },
    ]);
    expect(store.commitOutcome).not.toHaveBeenCalled();
    expect(store.commitSuccessOutcomes).toHaveBeenCalledOnce();
    expect(await readFile(path.join(test.output, "movie.mp4"), "utf8")).toBe("video");
  });

  it.each([
    false,
    true,
  ])("rolls back the entire group and settles every failed outcome (outcome write fails: %s)", async (outcomeWriteFails) => {
    const test = await fixture(["ABC-001-CD1.mp4", "ABC-001-CD2.mp4"]);
    const store = scrapeRuns();
    store.commitSuccessOutcomes.mockImplementation(() => {
      throw new Error("library constraint failed");
    });
    if (outcomeWriteFails)
      store.commitOutcome.mockImplementation(() => {
        throw new Error("outcome write failed");
      });
    const publication = commitScrapeTerminalResults({
      items: [],
      publicationPlan: test.plan,
      scrapeRuns: store,
      resolveRoot: test.resolveRoot,
      journal: createMemoryPublicationJournal(),
    });
    if (outcomeWriteFails) await expect(publication).rejects.toMatchObject({ name: "AggregateError" });
    else
      expect(await publication).toMatchObject([
        { status: "failed", resultId: "failed-outcome", error: expect.stringContaining("library constraint failed") },
        { status: "failed", resultId: "failed-outcome", error: expect.stringContaining("library constraint failed") },
      ]);
    expect(store.commitOutcome).toHaveBeenCalledTimes(2);
    for (const [index, source] of test.sourcePaths.entries()) {
      expect(await readFile(source, "utf8")).toBe("video");
      await expect(readFile(path.join(test.output, path.basename(test.sourcePaths[index])))).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(store.commitOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          attemptId: `attempt-${index + 1}`,
          error: expect.stringContaining("library constraint failed"),
        }),
      );
    }
  });
});
