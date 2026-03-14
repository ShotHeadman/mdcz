import { Website } from "@shared/enums";
import type { CrawlerData, LocalScanEntry, MaintenancePreviewItem } from "@shared/types";
import { describe, expect, it } from "vitest";
import {
  toDetailViewItemFromMaintenanceEntry,
  toDetailViewItemFromScrapeResult,
} from "@/components/detail/detailViewAdapters";
import type { ScrapeResult } from "@/store/scrapeStore";

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Original Title",
  title_zh: "本地标题",
  number: "ABC-123",
  actors: ["Actor A"],
  genres: ["Drama"],
  sample_images: ["https://example.com/remote-scene.jpg"],
  website: Website.DMM,
  ...overrides,
});

const createEntry = (crawlerData: CrawlerData): LocalScanEntry => ({
  id: "entry-1",
  videoPath: "/media/ABC-123.mp4",
  nfoPath: "/media/ABC-123.nfo",
  fileInfo: {
    filePath: "/media/ABC-123.mp4",
    fileName: "ABC-123.mp4",
    extension: ".mp4",
    number: "ABC-123",
    isSubtitled: false,
    resolution: "1080p",
  },
  crawlerData,
  scanError: undefined,
  assets: {
    poster: "/media/poster.jpg",
    thumb: "/media/thumb.jpg",
    fanart: "/media/fanart.jpg",
    sceneImages: ["/media/extrafanart/fanart1.jpg"],
    trailer: "/media/trailer.mp4",
    nfo: "/media/ABC-123.nfo",
    actorPhotos: [],
  },
  currentDir: "/media",
});

describe("toDetailViewItemFromScrapeResult", () => {
  it("maps scrape result fields into the shared detail item shape", () => {
    const result: ScrapeResult = {
      id: "scrape-1",
      status: "success",
      number: "ABC-123",
      title: "Remote Title",
      path: "/media/ABC-123.mp4",
      actors: ["Actor A"],
      outline: "Outline",
      tags: ["Drama"],
      release: "2026-01-01",
      duration: "01:30:00",
      resolution: "2160p",
      codec: "H.265",
      bitrate: "10 Mbps",
      directors: ["Director A"],
      series: "Series A",
      studio: "Studio A",
      publisher: "Publisher A",
      score: "4.5",
      poster_url: "https://example.com/poster.jpg",
      thumb_url: "https://example.com/thumb.jpg",
      fanart_url: "https://example.com/fanart.jpg",
      output_path: "/output",
      scene_images: ["https://example.com/scene-1.jpg"],
      error_msg: "Failed",
    };

    expect(toDetailViewItemFromScrapeResult(result)).toEqual({
      id: "scrape-1",
      status: "success",
      number: "ABC-123",
      title: "Remote Title",
      path: "/media/ABC-123.mp4",
      actors: ["Actor A"],
      outline: "Outline",
      tags: ["Drama"],
      release: "2026-01-01",
      duration: "01:30:00",
      resolution: "2160p",
      codec: "H.265",
      bitrate: "10 Mbps",
      directors: ["Director A"],
      series: "Series A",
      studio: "Studio A",
      publisher: "Publisher A",
      score: "4.5",
      posterUrl: "https://example.com/poster.jpg",
      thumbUrl: "https://example.com/thumb.jpg",
      fanartUrl: "https://example.com/fanart.jpg",
      outputPath: "/output",
      sceneImages: ["https://example.com/scene-1.jpg"],
      errorMessage: "Failed",
    });
  });

  it("surfaces scan errors before preview or execution starts", () => {
    const entry: LocalScanEntry = {
      ...createEntry(createCrawlerData()),
      scanError: "NFO 解析失败: Invalid NFO root",
      crawlerData: undefined,
    };

    expect(toDetailViewItemFromMaintenanceEntry(entry)).toEqual({
      id: "entry-1",
      status: "failed",
      number: "ABC-123",
      minimalErrorView: true,
      path: "/media/ABC-123.mp4",
      nfoPath: "/media/ABC-123.nfo",
      title: "ABC-123.mp4",
      actors: undefined,
      outline: undefined,
      tags: undefined,
      release: undefined,
      duration: undefined,
      resolution: "1080p",
      directors: undefined,
      series: undefined,
      studio: undefined,
      publisher: undefined,
      score: undefined,
      posterUrl: undefined,
      thumbUrl: undefined,
      fanartUrl: undefined,
      outputPath: undefined,
      sceneImages: undefined,
      errorMessage: "NFO 解析失败: Invalid NFO root",
    });
  });
});

describe("toDetailViewItemFromMaintenanceEntry", () => {
  it("prefers discovered local assets and formats maintenance metadata for the shared detail view", () => {
    const entry = createEntry(
      createCrawlerData({
        durationSeconds: 5423,
        plot: "Remote plot",
        plot_zh: "本地简介",
        poster_url: "https://example.com/poster.jpg",
        thumb_url: "https://example.com/thumb.jpg",
        fanart_url: "https://example.com/fanart.jpg",
        director: "Director A",
        studio: "Studio A",
        publisher: "Publisher A",
        series: "Series A",
        rating: 4.7,
        release_date: "2026-02-02",
      }),
    );
    const preview: MaintenancePreviewItem = {
      entryId: entry.id,
      status: "blocked",
      error: "Preview blocked",
    };

    expect(toDetailViewItemFromMaintenanceEntry(entry, preview)).toEqual({
      id: "entry-1",
      status: "failed",
      number: "ABC-123",
      minimalErrorView: false,
      path: "/media/ABC-123.mp4",
      nfoPath: "/media/ABC-123.nfo",
      title: "本地标题",
      actors: ["Actor A"],
      outline: "本地简介",
      tags: ["Drama"],
      release: "2026-02-02",
      duration: "01:30:23",
      resolution: "1080p",
      directors: ["Director A"],
      series: "Series A",
      studio: "Studio A",
      publisher: "Publisher A",
      score: "4.7",
      posterUrl: "/media/poster.jpg",
      thumbUrl: "/media/thumb.jpg",
      fanartUrl: "/media/fanart.jpg",
      outputPath: "/media",
      sceneImages: ["/media/extrafanart/fanart1.jpg"],
      errorMessage: "Preview blocked",
    });
  });

  it("falls back to preview crawler data when local NFO parsing failed but refresh preview succeeded", () => {
    const entry: LocalScanEntry = {
      ...createEntry(createCrawlerData()),
      crawlerData: undefined,
      scanError: "NFO 解析失败: NFO missing website",
    };
    const preview: MaintenancePreviewItem = {
      entryId: entry.id,
      status: "ready",
      proposedCrawlerData: createCrawlerData({
        title: "Remote Title",
        title_zh: "远程标题",
        plot: "Remote Plot",
        poster_url: "https://example.com/poster.jpg",
        thumb_url: "https://example.com/thumb.jpg",
      }),
    };

    expect(toDetailViewItemFromMaintenanceEntry(entry, preview)).toEqual({
      id: "entry-1",
      status: "success",
      number: "ABC-123",
      minimalErrorView: false,
      path: "/media/ABC-123.mp4",
      nfoPath: "/media/ABC-123.nfo",
      title: "远程标题",
      actors: ["Actor A"],
      outline: "Remote Plot",
      tags: ["Drama"],
      release: undefined,
      duration: undefined,
      resolution: "1080p",
      directors: undefined,
      series: undefined,
      studio: undefined,
      publisher: undefined,
      score: undefined,
      posterUrl: "/media/poster.jpg",
      thumbUrl: "/media/thumb.jpg",
      fanartUrl: "/media/fanart.jpg",
      outputPath: "/media",
      sceneImages: ["/media/extrafanart/fanart1.jpg"],
      errorMessage: undefined,
    });
  });
});
