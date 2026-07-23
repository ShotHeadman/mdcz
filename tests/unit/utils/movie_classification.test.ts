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
  title: "Sample",
  number: "ABC-123",
  actors: [],
  genres: [],
  scene_images: [],
  website: Website.DMM,
  ...overrides,
});

describe("classifyMovie", () => {
  it("prefers filename classification over crawler hints", () => {
    expect(
      classifyMovie(createFileInfo({ filenameUncensoredChoice: "umr" }), createCrawlerData({ genres: ["流出"] })),
    ).toMatchObject({ uncensored: true, umr: true, leak: false });
  });

  it("keeps an explicit local choice above a filename classification", () => {
    expect(
      classifyMovie(createFileInfo({ filenameUncensoredChoice: "umr" }), createCrawlerData(), {
        uncensoredChoice: "leak",
      }),
    ).toMatchObject({ uncensored: true, umr: false, leak: true });
  });
});
