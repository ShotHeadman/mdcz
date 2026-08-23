import { Website } from "@mdcz/shared/enums";
import { POSTER_TAG_BADGE_TYPE_OPTIONS } from "@mdcz/shared/posterBadges";
import type { CrawlerData, FileInfo, NfoLocalState } from "@mdcz/shared/types";
import { describe, expect, it } from "vitest";
import { resolvePosterBadgeDefinitions } from "./posterBadges";

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Sample",
  number: "ABC-123",
  actors: [],
  genres: [],
  scene_images: [],
  website: Website.DMM,
  ...overrides,
});

const createFileInfo = (overrides: Partial<FileInfo> = {}): FileInfo => ({
  filePath: "/tmp/ABC-123.mp4",
  fileName: "ABC-123.mp4",
  extension: ".mp4",
  number: "ABC-123",
  isSubtitled: false,
  ...overrides,
});

const badgeIds = (data: CrawlerData, fileInfo?: FileInfo, localState?: NfoLocalState): string[] =>
  resolvePosterBadgeDefinitions(data, fileInfo, localState, POSTER_TAG_BADGE_TYPE_OPTIONS).map(
    (definition) => definition.id,
  );

describe("resolvePosterBadgeDefinitions", () => {
  it("resolves subtitle, censored, and 4K badges in stable definition order", () => {
    expect(
      badgeIds(
        createCrawlerData(),
        createFileInfo({ isSubtitled: true, subtitleTag: "中文字幕", resolution: " 2160p " }),
      ),
    ).toEqual(["subtitle", "censored", "fourK"]);
  });

  it("resolves local uncensored choices without also classifying the movie as censored", () => {
    expect(badgeIds(createCrawlerData(), createFileInfo(), { uncensoredChoice: "umr" })).toEqual(["umr"]);
    expect(badgeIds(createCrawlerData(), createFileInfo(), { uncensoredChoice: "leak" })).toEqual(["leak"]);
    expect(badgeIds(createCrawlerData(), createFileInfo(), { uncensoredChoice: "uncensored" })).toEqual(["uncensored"]);
  });

  it("resolves metadata classifications and supported display resolutions", () => {
    expect(badgeIds(createCrawlerData({ genres: ["流出"] }), createFileInfo({ resolution: "1080P" }))).toEqual([
      "leak",
      "fullHd",
    ]);
    expect(badgeIds(createCrawlerData({ number: "FC2-12345" }), createFileInfo({ resolution: "8k" }))).toEqual([
      "uncensored",
      "eightK",
    ]);
    expect(badgeIds(createCrawlerData(), createFileInfo({ resolution: "4K" }))).toEqual(["censored", "fourK"]);
  });

  it("uses local tags without file information and honors the enabled type filter", () => {
    const data = createCrawlerData();
    const localState = { tags: ["中字", "破解"] };

    expect(resolvePosterBadgeDefinitions(data, undefined, localState, ["subtitle", "uncensored"])).toEqual([
      expect.objectContaining({ id: "subtitle", label: "中字" }),
    ]);
    expect(resolvePosterBadgeDefinitions(data, undefined, undefined, [])).toEqual([]);
  });
});
