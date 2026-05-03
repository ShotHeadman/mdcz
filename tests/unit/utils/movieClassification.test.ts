import { classifyMovie } from "@mdcz/runtime/scrape/utils/movieClassification";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData, FileInfo } from "@mdcz/shared/types";
import { describe, expect, it } from "vitest";

const createFileInfo = (overrides: Partial<FileInfo> = {}): FileInfo => ({
  filePath: "/tmp/ABC-123.mp4",
  fileName: "ABC-123",
  extension: ".mp4",
  number: "ABC-123",
  isSubtitled: false,
  ...overrides,
});

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Sample Title",
  number: "ABC-123",
  actors: [],
  genres: [],
  scene_images: [],
  website: Website.DMM,
  ...overrides,
});

describe("classifyMovie", () => {
  it("marks uncensored titles from number patterns and filename suffixes", () => {
    expect(
      classifyMovie(
        createFileInfo({
          number: "FC2-123456",
          isSubtitled: true,
        }),
        createCrawlerData({
          number: "FC2-123456",
        }),
      ),
    ).toEqual({
      subtitled: true,
      uncensored: true,
      umr: false,
      leak: false,
    });

    expect(
      classifyMovie(
        createFileInfo({
          isUncensored: true,
        }),
        createCrawlerData(),
      ),
    ).toMatchObject({
      uncensored: true,
      umr: false,
      leak: false,
    });
  });

  it("treats UMR and leak hints as uncensored subclasses", () => {
    expect(
      classifyMovie(
        createFileInfo(),
        createCrawlerData({
          number: "SSIS-243",
          title: "高清无码 破解版",
        }),
      ),
    ).toEqual({
      subtitled: false,
      uncensored: true,
      umr: true,
      leak: false,
    });

    expect(
      classifyMovie(
        createFileInfo(),
        createCrawlerData({
          number: "SSIS-243",
          genres: ["流出"],
        }),
      ),
    ).toEqual({
      subtitled: false,
      uncensored: true,
      umr: false,
      leak: true,
    });
  });

  it("leaves ordinary censored titles unclassified", () => {
    expect(classifyMovie(createFileInfo(), createCrawlerData())).toEqual({
      subtitled: false,
      uncensored: false,
      umr: false,
      leak: false,
    });
  });

  it("lets local NFO state override the uncensored subtype", () => {
    expect(
      classifyMovie(createFileInfo(), createCrawlerData(), {
        uncensoredChoice: "leak",
      }),
    ).toEqual({
      subtitled: false,
      uncensored: true,
      umr: false,
      leak: true,
    });
  });
});
