import { describe, expect, it } from "vitest";
import { toScrapeResultDto } from "./scrapeDtos";

describe("scrape asset DTO projection", () => {
  it("returns only serviceable local scene and trailer references with their explicit root", () => {
    expect(
      toScrapeResultDto(
        {
          id: "outcome",
          attemptId: "attempt",
          itemId: "item",
          outcome: "success",
          error: null,
          crawlerDataJson: null,
          nfoRootId: null,
          nfoRelativePath: null,
          outputRootId: "root",
          outputRelativePath: "ABC-001/ABC-001.mp4",
          uncensoredAmbiguous: false,
          size: 1,
          modifiedAt: null,
          completedAt: new Date(0),
        },
        {
          id: "item",
          runId: "run",
          ordinal: 0,
          rootId: "root",
          relativePath: "ABC-001.mp4",
          manualUrl: null,
          uncensoredChoice: null,
        },
        {
          runId: "run",
          rootDisplayName: "Root",
          runCreatedAt: new Date(0),
          assets: [
            {
              kind: "scene",
              uri: "ABC-001/extrafanart/fanart1.jpg",
              rootId: "metadata-root",
              relativePath: "ABC-001/extrafanart/fanart1.jpg",
            },
            {
              kind: "trailer",
              uri: "ABC-001/ABC-001-trailer.mp4",
              rootId: "metadata-root",
              relativePath: "ABC-001/ABC-001-trailer.mp4",
            },
          ],
        },
      ).assets,
    ).toEqual([
      {
        type: "local",
        kind: "scene",
        file: { rootId: "metadata-root", relativePath: "ABC-001/extrafanart/fanart1.jpg" },
      },
      {
        type: "local",
        kind: "trailer",
        file: { rootId: "metadata-root", relativePath: "ABC-001/ABC-001-trailer.mp4" },
      },
    ]);
  });
});
