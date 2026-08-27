import { describe, expect, it } from "vitest";
import type { ScrapeRunSnapshot } from "./ScrapeRunSession";
import { toScrapeRunSnapshotDto } from "./scrapeRunSnapshotDto";

describe("toScrapeRunSnapshotDto", () => {
  it("copies live item assets and output refs from the scrape result", () => {
    const snapshot: ScrapeRunSnapshot = {
      runId: "run-1",
      generation: 0,
      status: "running",
      progress: { percent: 50, completedItems: 0, totalItems: 1 },
      items: [
        {
          id: "item-1",
          rootId: "root-1",
          relativePath: "ABC-001.mp4",
          sourcePath: "/media/ABC-001.mp4",
          status: "success",
          error: null,
          result: {
            fileId: "item-1",
            rootId: "root-1",
            relativePath: "ABC-001.mp4",
            fileName: "ABC-001.mp4",
            status: "success",
            resultId: "outcome-1",
            output: { rootId: "output-1", relativePath: "organized/ABC-001.mp4" },
            nfo: { rootId: "output-1", relativePath: "organized/ABC-001.nfo" },
            assets: [
              {
                type: "local",
                kind: "poster",
                file: { rootId: "output-1", relativePath: "organized/ABC-001-poster.jpg" },
              },
              { type: "remote", kind: "trailer", url: "https://example.com/trailer.mp4" },
            ],
            uncensoredAmbiguous: true,
          },
        },
      ],
      latestStage: { stage: "download", message: "Downloading", itemId: "item-1", relativePath: "ABC-001.mp4" },
      logs: [],
      error: null,
    };

    const dto = toScrapeRunSnapshotDto({
      manifest: {
        id: "run-1",
        rootId: "root-1",
        createdAt: new Date("2026-08-27T00:00:00.000Z"),
        items: [{ id: "item-1", rootId: "root-1", relativePath: "ABC-001.mp4", manualUrl: null }],
      },
      snapshot,
      startedAt: new Date("2026-08-27T00:01:00.000Z"),
      rootDisplayName: "Media",
    });

    expect(dto.items).toEqual([
      expect.objectContaining({
        id: "item-1",
        resultId: "outcome-1",
        outputRootId: "output-1",
        outputRelativePath: "organized/ABC-001.mp4",
        nfoRootId: "output-1",
        nfoRelativePath: "organized/ABC-001.nfo",
        assets: [
          { type: "local", kind: "poster", file: { rootId: "output-1", relativePath: "organized/ABC-001-poster.jpg" } },
          { type: "remote", kind: "trailer", url: "https://example.com/trailer.mp4" },
        ],
        uncensoredAmbiguous: true,
      }),
    ]);
    expect(dto.ambiguousUncensoredItems).toEqual([
      expect.objectContaining({ id: "outcome-1", nfoRelativePath: "organized/ABC-001.nfo" }),
    ]);
  });
});
