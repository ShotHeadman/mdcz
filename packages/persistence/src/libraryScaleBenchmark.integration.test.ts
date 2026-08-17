import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it } from "vitest";
import type { PersistenceDatabase } from "./database";
import { LibraryRepository } from "./libraryRepository";
import { createTestPersistenceDatabase } from "./testDatabase";

const benchmarkEnabled = process.env.MDCZ_LIBRARY_BENCHMARK === "1";
const fixtureSize = 10_000;

let database: PersistenceDatabase | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

const measure = async <T>(run: () => Promise<T>): Promise<{ heapDeltaBytes: number; ms: number; value: T }> => {
  const heapBefore = process.memoryUsage().heapUsed;
  const startedAt = performance.now();
  const value = await run();
  return {
    heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
    ms: performance.now() - startedAt,
    value,
  };
};

describe.skipIf(!benchmarkEnabled)("library scale benchmark", () => {
  it("records a 10,000-entry full-list versus paged-list baseline", async () => {
    database = createTestPersistenceDatabase();
    const repository = new LibraryRepository(database);
    const upsert = await measure(async () => {
      for (let index = 0; index < fixtureSize; index += 1) {
        await repository.upsertEntry({
          id: `entry-${index.toString().padStart(5, "0")}`,
          rootId: `root-${index % 4}`,
          rootRelativePath: `movies/${index.toString().padStart(5, "0")}.mp4`,
          title: index === fixtureSize - 1 ? "Unique benchmark needle" : `Generated title ${index}`,
          createdAt: new Date(1_700_000_000_000 + index),
          size: index + 1,
        });
      }
    });
    const fullList = await measure(async () => await repository.listEntries());
    const firstPage = await measure(async () => await repository.listEntriesPage({ limit: 100 }));
    const filteredPage = await measure(
      async () => await repository.listEntriesPage({ limit: 100, query: "unique benchmark needle" }),
    );

    expect(fullList.value).toHaveLength(fixtureSize);
    expect(firstPage.value).toMatchObject({ hasMore: true, total: fixtureSize });
    expect(firstPage.value.entries).toHaveLength(100);
    expect(filteredPage.value).toMatchObject({ hasMore: false, total: 1 });

    console.info("library-scale-benchmark", {
      fixtureSize,
      upsert: { heapDeltaBytes: upsert.heapDeltaBytes, ms: upsert.ms },
      fullList: { heapDeltaBytes: fullList.heapDeltaBytes, ms: fullList.ms },
      firstPage: { heapDeltaBytes: firstPage.heapDeltaBytes, ms: firstPage.ms },
      filteredPage: { heapDeltaBytes: filteredPage.heapDeltaBytes, ms: filteredPage.ms },
    });
  }, 120_000);
});
