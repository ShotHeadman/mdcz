import { prepareImageAlternativesForDownload } from "@main/services/scraper/prepareImageAlternativesForDownload";
import { isDmmImageUrl } from "@main/utils/dmmImage";
import { Website } from "@shared/enums";
import { describe, expect, it } from "vitest";

describe("isDmmImageUrl", () => {
  it("recognizes DMM image hosts only", () => {
    expect(isDmmImageUrl("https://pics.dmm.co.jp/digital/video/abf00125/abf00125pl.jpg")).toBe(true);
    expect(isDmmImageUrl("https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/abf00125/abf00125ps.jpg")).toBe(true);
    expect(isDmmImageUrl("https://javdb.com/covers/abf-125.jpg")).toBe(false);
    expect(isDmmImageUrl("not-a-url")).toBe(false);
    expect(isDmmImageUrl(undefined)).toBe(false);
  });
});

describe("prepareImageAlternativesForDownload", () => {
  it("expands DMM image candidates even when metadata came from a non-DMM source", () => {
    const result = prepareImageAlternativesForDownload(
      {
        number: "ABF-125",
        thumb_url: "https://pics.dmm.co.jp/digital/video/abf00125/abf00125pl.jpg",
        poster_url: "https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/abf00125/abf00125ps.jpg",
      },
      {
        thumb_url: ["https://cdn.example.com/thumb-backup.jpg"],
        poster_url: ["https://cdn.example.com/poster-backup.jpg"],
      },
      {
        thumb_url: Website.AVBASE,
        poster_url: Website.JAVDB,
        scene_images: Website.AVBASE,
      },
    );

    expect(result.thumb_url).toEqual([
      "https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/abf00125/abf00125pl.jpg",
      "https://cdn.example.com/thumb-backup.jpg",
    ]);
    expect(result.poster_url).toEqual([
      "https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/abf125/abf125ps.jpg",
      "https://cdn.example.com/poster-backup.jpg",
    ]);
  });

  it("leaves non-DMM image URLs untouched", () => {
    const result = prepareImageAlternativesForDownload(
      {
        number: "ABF-125",
        thumb_url: "https://javdb.com/covers/abf-125-thumb.jpg",
        poster_url: "https://avbase.example.com/posters/abf-125.jpg",
      },
      {
        thumb_url: ["https://cdn.example.com/thumb-backup.jpg"],
        poster_url: ["https://cdn.example.com/poster-backup.jpg"],
      },
      {
        thumb_url: Website.JAVDB,
        poster_url: Website.AVBASE,
        scene_images: Website.JAVDB,
      },
    );

    expect(result.thumb_url).toEqual(["https://cdn.example.com/thumb-backup.jpg"]);
    expect(result.poster_url).toEqual(["https://cdn.example.com/poster-backup.jpg"]);
  });
});
