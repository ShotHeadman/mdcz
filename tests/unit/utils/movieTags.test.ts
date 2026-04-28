import { buildMovieTags, resolvePosterBadgeDefinitions } from "@main/utils/movieTags";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData, FileInfo, NfoLocalState } from "@mdcz/shared/types";
import { describe, expect, it } from "vitest";

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

describe("movieTags", () => {
  it("builds the same managed tags used by NFO generation", () => {
    const tags = buildMovieTags(
      createCrawlerData({
        title: "高清无码 破解版",
      }),
      createFileInfo({
        isSubtitled: true,
        subtitleTag: "中文字幕",
      }),
      undefined,
    );

    expect(tags).toEqual(["破解", "中文字幕"]);
  });

  it("resolves poster badge definitions in filename marker order", () => {
    const badges = resolvePosterBadgeDefinitions(
      createCrawlerData({
        title: "Sample",
      }),
      createFileInfo({
        isSubtitled: true,
      }),
      {
        uncensoredChoice: "leak",
      },
    );

    expect(badges.map((badge) => badge.label)).toEqual(["中字", "流出"]);
  });

  it("maps local subtitle and uncensored tags into supported badge labels", () => {
    const localState: NfoLocalState = {
      tags: ["中文字幕", "自定义标签"],
      uncensoredChoice: "umr",
    };

    const badges = resolvePosterBadgeDefinitions(createCrawlerData(), undefined, localState);

    expect(badges.map((badge) => badge.label)).toEqual(["中字", "破解"]);
  });

  it("filters resolved poster badges by enabled built-in badge types", () => {
    const badges = resolvePosterBadgeDefinitions(
      createCrawlerData(),
      createFileInfo({
        isSubtitled: true,
      }),
      {
        uncensoredChoice: "leak",
      },
      ["subtitle"],
    );

    expect(badges.map((badge) => badge.label)).toEqual(["中字"]);
  });

  it("treats ordinary titles as censored poster badges only when the uncensored chain does not match", () => {
    const censoredBadges = resolvePosterBadgeDefinitions(
      createCrawlerData(),
      createFileInfo({
        resolution: "1080P",
      }),
      undefined,
      ["censored", "fullHd"],
    );
    const uncensoredBadges = resolvePosterBadgeDefinitions(
      createCrawlerData({
        number: "FC2-123456",
      }),
      createFileInfo({
        number: "FC2-123456",
        resolution: "1080P",
      }),
      undefined,
      ["censored", "fullHd", "uncensored"],
    );

    expect(censoredBadges.map((badge) => badge.label)).toEqual(["有码", "1080P"]);
    expect(uncensoredBadges.map((badge) => badge.label)).toEqual(["无码", "1080P"]);
  });

  it("maps poster resolution badges from 1080P, 2160P/4K, and 8K file info", () => {
    const fullHdBadges = resolvePosterBadgeDefinitions(
      createCrawlerData(),
      createFileInfo({
        resolution: "1080P",
      }),
      undefined,
      ["fullHd", "fourK", "eightK"],
    );
    const fourKBadges = resolvePosterBadgeDefinitions(
      createCrawlerData(),
      createFileInfo({
        resolution: "2160P",
      }),
      undefined,
      ["fullHd", "fourK", "eightK"],
    );
    const fourKLiteralBadges = resolvePosterBadgeDefinitions(
      createCrawlerData(),
      createFileInfo({
        resolution: "4K",
      }),
      undefined,
      ["fullHd", "fourK", "eightK"],
    );
    const eightKBadges = resolvePosterBadgeDefinitions(
      createCrawlerData(),
      createFileInfo({
        resolution: "8K",
      }),
      undefined,
      ["fullHd", "fourK", "eightK"],
    );

    expect(fullHdBadges.map((badge) => badge.label)).toEqual(["1080P"]);
    expect(fourKBadges.map((badge) => badge.label)).toEqual(["4K"]);
    expect(fourKLiteralBadges.map((badge) => badge.label)).toEqual(["4K"]);
    expect(eightKBadges.map((badge) => badge.label)).toEqual(["8K"]);
  });
});
