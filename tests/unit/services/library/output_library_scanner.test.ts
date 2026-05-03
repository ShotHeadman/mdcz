import { OutputLibraryScanner } from "@main/services/library/OutputLibraryScanner";
import { LibraryRepository, MediaRootRepository } from "@mdcz/persistence";
import { createMediaRoot } from "@mdcz/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestPersistenceDatabase } from "../../../../packages/persistence/src/testDatabase";

const databases: ReturnType<typeof createTestPersistenceDatabase>[] = [];

const createPersistenceService = () => {
  const database = createTestPersistenceDatabase();
  databases.push(database);
  const library = new LibraryRepository(database);
  const mediaRoots = new MediaRootRepository(database);
  return {
    library,
    mediaRoots,
    service: {
      getState: vi.fn(async () => ({
        database,
        repositories: {
          library,
          mediaRoots,
        },
      })),
    },
  };
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

  it("uses the latest persisted scrape output and caches until invalidated", async () => {
    const { library, service } = createPersistenceService();
    await library.upsertScrapeOutput({
      taskId: "task-1",
      rootId: "root-1",
      outputDirectory: "output-root",
      fileCount: 2,
      totalBytes: 10,
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
      fileCount: 2,
      totalBytes: 10,
      scannedAt: 1_700_000_000_000,
      rootPath: "output-root",
    });

    await library.upsertScrapeOutput({
      taskId: "task-2",
      rootId: "root-1",
      outputDirectory: "next-output",
      fileCount: 3,
      totalBytes: 18,
      completedAt: new Date(1_700_000_000_100),
    });
    await expect(scanner.getSummary()).resolves.toEqual(first);

    scanner.invalidate();
    await expect(scanner.getSummary()).resolves.toEqual({
      fileCount: 3,
      totalBytes: 18,
      scannedAt: 1_700_000_000_100,
      rootPath: "next-output",
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
