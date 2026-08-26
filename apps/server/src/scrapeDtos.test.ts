import { describe, expect, it } from "vitest";
import { toScrapeAssetDto } from "./scrapeDtos";

describe("scrape asset DTO projection", () => {
  it("returns only serviceable local scene and trailer references with their explicit root", () => {
    expect(
      toScrapeAssetDto([
        { kind: "scene", rootId: "metadata-root", relativePath: "ABC-001/extrafanart/fanart1.jpg" },
        { kind: "scene", rootId: null, relativePath: null },
        { kind: "trailer", rootId: "metadata-root", relativePath: "ABC-001/ABC-001-trailer.mp4" },
      ]),
    ).toEqual({
      assetRootId: "metadata-root",
      sceneImageRelativePaths: ["ABC-001/extrafanart/fanart1.jpg"],
      trailerRelativePath: "ABC-001/ABC-001-trailer.mp4",
    });
  });
});
