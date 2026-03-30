import { Website } from "@shared/enums";
import type { ScrapeResult } from "@shared/types";
import { describe, expect, it } from "vitest";
import {
  formatBitrate,
  formatDuration,
  toDetailViewItemFromScrapeResult,
} from "@/components/detail/detailViewAdapters";

describe("formatDuration", () => {
  it("returns a hh:mm:ss string for positive finite durations", () => {
    expect(formatDuration(3661)).toBe("01:01:01");
  });

  it("returns undefined for zero, negative, or invalid durations", () => {
    expect(formatDuration(0)).toBeUndefined();
    expect(formatDuration(-10)).toBeUndefined();
    expect(formatDuration(Number.NaN)).toBeUndefined();
  });
});

describe("formatBitrate", () => {
  it("formats bitrate values as Mbps", () => {
    expect(formatBitrate(12_500_000)).toBe("12.5 Mbps");
  });

  it("returns undefined for zero, negative, or invalid bitrates", () => {
    expect(formatBitrate(0)).toBeUndefined();
    expect(formatBitrate(-1)).toBeUndefined();
    expect(formatBitrate(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});

describe("toDetailViewItemFromScrapeResult", () => {
  it("maps raw scrape results into detail-view fields", () => {
    const payload: ScrapeResult = {
      fileId: "file:/library/ABC-123/ABC-123.mp4",
      status: "success",
      fileInfo: {
        filePath: "/library/ABC-123/ABC-123.mp4",
        fileName: "ABC-123.mp4",
        extension: ".mp4",
        number: "ABC-123",
        isSubtitled: false,
        part: {
          number: 1,
          suffix: "-cd1",
        },
      },
      crawlerData: {
        title: "Original Title",
        title_zh: "中文标题",
        number: "ABC-123",
        actors: ["Actor A", "Actor B"],
        genres: ["Drama"],
        plot: "Original plot",
        plot_zh: "中文简介",
        release_date: "2025-01-02",
        durationSeconds: 3600,
        rating: 4.6,
        thumb_url: "https://example.com/thumb.jpg",
        poster_url: "https://example.com/poster.jpg",
        fanart_url: "https://example.com/fanart.jpg",
        director: "Director A",
        studio: "Studio A",
        publisher: "Publisher A",
        series: "Series A",
        scene_images: [],
        website: Website.DMM,
      },
      videoMeta: {
        durationSeconds: 3661,
        width: 1920,
        height: 1080,
        codec: "h264",
        bitrate: 12_500_000,
      },
      assets: {
        poster: "/art/poster.jpg",
        thumb: "/art/thumb.jpg",
        fanart: "/art/fanart.jpg",
        sceneImages: ["/art/scene-1.jpg"],
        downloaded: ["/art/poster.jpg"],
      },
      outputPath: "/output/ABC-123",
      nfoPath: "/output/ABC-123/ABC-123.nfo",
      sources: {
        title: Website.DMM,
      },
      uncensoredAmbiguous: true,
    };

    expect(toDetailViewItemFromScrapeResult(payload)).toMatchObject({
      id: "file:/library/ABC-123/ABC-123.mp4",
      status: "success",
      number: "ABC-123",
      path: "/library/ABC-123/ABC-123.mp4",
      title: "中文标题",
      outline: "中文简介",
      duration: "01:01:01",
      resolution: "1920x1080",
      codec: "h264",
      bitrate: "12.5 Mbps",
      posterUrl: "/art/poster.jpg",
      thumbUrl: "/art/thumb.jpg",
      fanartUrl: "/art/fanart.jpg",
      sceneImages: ["/art/scene-1.jpg"],
      outputPath: "/output/ABC-123",
      nfoPath: "/output/ABC-123/ABC-123.nfo",
      score: "4.6",
    });
  });

  it("falls back to remote assets and failure metadata when local assets are missing", () => {
    const payload: ScrapeResult = {
      fileId: "file:C:/library/XYZ-789/XYZ-789.mp4",
      status: "failed",
      fileInfo: {
        filePath: "C:\\library\\XYZ-789\\XYZ-789.mp4",
        fileName: "XYZ-789.mp4",
        extension: ".mp4",
        number: "XYZ-789",
        isSubtitled: false,
      },
      crawlerData: {
        title: "XYZ-789",
        number: "XYZ-789",
        actors: [],
        genres: [],
        plot: "Plot",
        thumb_url: "https://example.com/thumb.jpg",
        fanart_url: "https://example.com/fanart.jpg",
        poster_url: "https://example.com/poster.jpg",
        scene_images: [],
        website: Website.DMM,
      },
      error: "Lookup failed",
    };

    expect(toDetailViewItemFromScrapeResult(payload)).toMatchObject({
      status: "failed",
      posterUrl: "https://example.com/poster.jpg",
      thumbUrl: "https://example.com/thumb.jpg",
      fanartUrl: "https://example.com/fanart.jpg",
      errorMessage: "Lookup failed",
    });
  });
});
