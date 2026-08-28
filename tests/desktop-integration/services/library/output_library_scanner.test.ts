import { OutputLibraryScanner } from "@main/services/library/OutputLibraryScanner";
import { createMediaRoot } from "@mdcz/media-store";
import {
  LibraryRepository,
  MediaRootRepository,
  type PersistenceDatabase,
  ScrapeRunRepository,
} from "@mdcz/persistence";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestPersistenceDatabase } from "../../../../packages/persistence/src/testDatabase";

const databases: PersistenceDatabase[] = [];

const createPersistenceService = () => {
  const database = createTestPersistenceDatabase();
  databases.push(database);
  const library = new LibraryRepository(database);
  const mediaRoots = new MediaRootRepository(database);
  const scrapeRuns = new ScrapeRunRepository(database);
  return {
    database,
    library,
    mediaRoots,
    scrapeRuns,
    service: {
      getState: vi.fn(async () => ({
        database,
        repositories: {
          library,
          mediaRoots,
          scrapeRuns,
        },
      })),
    },
  };
};

const createCompletedRun = async (
  database: PersistenceDatabase,
  scrapeRuns: ScrapeRunRepository,
  input: {
    id: string;
    completedAt: Date;
    outputDirectory: string;
    outputRelativePath: string;
    size: number;
  },
) => {
  const manifest = await scrapeRuns.create({
    id: input.id,
    rootId: "root-1",
    outputRootId: "root-1",
    executionMode: "single",
    items: [{ id: `${input.id}:item`, ordinal: 0, rootId: "root-1", relativePath: input.outputRelativePath }],
  });
  database.sqlite.transaction(() =>
    scrapeRuns.commitSuccessOutcome({
      outcome: "success",
      itemId: manifest.items[0].id,
      crawlerDataJson: JSON.stringify({ number: input.id }),
      outputRootId: "root-1",
      outputRelativePath: input.outputRelativePath,
      size: input.size,
      completedAt: input.completedAt,
      libraryEntry: {
        mediaIdentity: input.id,
        rootId: "root-1",
        rootRelativePath: input.outputRelativePath,
        size: input.size,
        number: input.id,
        crawlerDataJson: JSON.stringify({ number: input.id }),
        lastKnownPath: input.outputRelativePath,
        createdAt: input.completedAt,
      },
    }),
  )();
  await scrapeRuns.finalize({
    runId: manifest.id,
    disposition: "completed",
    completedAt: input.completedAt,
  });
};

describe("OutputLibraryScanner", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const database of databases.splice(0)) {
      database.close();
    }
  });

  it("returns an empty summary without a persistence service", async () => {
    const scanner = new OutputLibraryScanner({
      ttlMs: 60_000,
      now: () => 12_345,
      logger: { warn: vi.fn() },
    });

    await expect(scanner.getSummary()).resolves.toEqual({
      fileCount: 0,
      totalBytes: 0,
      scannedAt: 12_345,
      rootPath: null,
    });
  });

  it("uses the latest persisted scrape run summary and caches until invalidated", async () => {
    const { database, mediaRoots, scrapeRuns, service } = createPersistenceService();
    await mediaRoots.upsert(createMediaRoot({ id: "root-1", displayName: "Output", hostPath: "/media/output" }));
    await createCompletedRun(database, scrapeRuns, {
      id: "run-1",
      outputDirectory: "output-root",
      outputRelativePath: "A.mp4",
      size: 10,
      completedAt: new Date(1_700_000_000_000),
    });
    const scanner = new OutputLibraryScanner({
      persistenceService: service as never,
      ttlMs: 60_000,
      now: () => 12_345,
      logger: { warn: vi.fn() },
    });

    const first = await scanner.getSummary();
    expect(first).toEqual({
      fileCount: 1,
      totalBytes: 10,
      scannedAt: 1_700_000_000_000,
      rootPath: "/media/output",
    });

    await createCompletedRun(database, scrapeRuns, {
      id: "run-2",
      outputDirectory: "next-output",
      outputRelativePath: "B.mp4",
      size: 18,
      completedAt: new Date(1_700_000_000_100),
    });
    await expect(scanner.getSummary()).resolves.toEqual(first);

    scanner.invalidate();
    await expect(scanner.getSummary()).resolves.toEqual({
      fileCount: 1,
      totalBytes: 18,
      scannedAt: 1_700_000_000_100,
      rootPath: "/media/output",
    });
  });

  it("falls back to persisted library entries when no scrape output exists", async () => {
    const { library, mediaRoots, service } = createPersistenceService();
    await mediaRoots.upsert(
      createMediaRoot({
        id: "root-1",
        displayName: "Output",
        hostPath: "/media/output",
      }),
    );
    await library.upsertEntry({
      rootId: "root-1",
      rootRelativePath: "A.mp4",
      size: 4,
      number: "A",
    });
    await library.upsertEntry({
      rootId: "root-1",
      rootRelativePath: "nested/B.mkv",
      size: 6,
      number: "B",
    });

    const scanner = new OutputLibraryScanner({
      persistenceService: service as never,
      now: () => 456,
      logger: { warn: vi.fn() },
    });

    await expect(scanner.getSummary()).resolves.toEqual({
      fileCount: 2,
      totalBytes: 10,
      scannedAt: 456,
      rootPath: null,
    });
  });
});
