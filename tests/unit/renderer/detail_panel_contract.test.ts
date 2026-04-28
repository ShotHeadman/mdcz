import { Website } from "@mdcz/shared/enums";
import type { CrawlerData, LocalScanEntry, MaintenancePreviewItem, ScrapeResult } from "@mdcz/shared/types";
import { describe, expect, it } from "vitest";
import {
  formatBitrate,
  formatDuration,
  normalizeDetailOutlineText,
  toDetailViewItemFromMaintenanceEntry,
  toDetailViewItemFromScrapeResult,
} from "@/components/detail/detailViewAdapters";

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Original Title",
  title_zh: "本地标题",
  number: "ABC-123",
  actors: ["Actor A"],
  genres: ["Drama"],
  scene_images: ["https://example.com/remote-scene.jpg"],
  website: Website.DMM,
  ...overrides,
});

const createEntry = (crawlerData?: CrawlerData): LocalScanEntry => ({
  fileId: "entry-1",
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
    actorPhotos: [],
  },
  currentDir: "/media",
});

describe("detail panel adapter contract", () => {
  it("normalizes text and formats numeric metadata for the redesigned detail panel", () => {
    expect(normalizeDetailOutlineText('第一段<br/>第二段<a href="https://example.com">链接文字</a>')).toBe(
      "第一段\n第二段链接文字",
    );
    expect(formatDuration(3661)).toBe("01:01:01");
    expect(formatDuration(0)).toBeUndefined();
    expect(formatBitrate(12_500_000)).toBe("12.5 Mbps");
    expect(formatBitrate(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it("maps scrape results into the shared detail item shape with local asset priority", () => {
    const payload: ScrapeResult = {
      fileId: "file:/library/ABC-123/ABC-123.mp4",
      status: "success",
      fileInfo: {
        filePath: "/library/ABC-123/ABC-123.mp4",
        fileName: "ABC-123.mp4",
        extension: ".mp4",
        number: "ABC-123",
        isSubtitled: false,
      },
      crawlerData: createCrawlerData({
        title: "Remote Title",
        title_zh: "中文标题",
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
      }),
      videoMeta: {
        durationSeconds: 3661,
        width: 1920,
        height: 1080,
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
      uncensoredAmbiguous: true,
    };

    expect(toDetailViewItemFromScrapeResult(payload)).toMatchObject({
      id: "file:/library/ABC-123/ABC-123.mp4",
      status: "success",
      number: "ABC-123",
      title: "中文标题",
      plot: "中文简介",
      durationSeconds: 3661,
      resolution: "1920x1080",
      bitrate: 12_500_000,
      posterUrl: "/art/poster.jpg",
      thumbUrl: "/art/thumb.jpg",
      fanartUrl: "/art/fanart.jpg",
      sceneImages: ["/art/scene-1.jpg"],
      outputPath: "/output/ABC-123",
      nfoPath: "/output/ABC-123/ABC-123.nfo",
      rating: 4.6,
    });
  });

  it("keeps maintenance scan errors minimal but can fall back to successful preview data", () => {
    expect(
      toDetailViewItemFromMaintenanceEntry({
        ...createEntry(),
        scanError: "NFO 解析失败: Invalid NFO root",
        crawlerData: undefined,
      }),
    ).toMatchObject({
      id: "entry-1",
      status: "failed",
      minimalErrorView: true,
      title: "ABC-123.mp4",
      errorMessage: "NFO 解析失败: Invalid NFO root",
    });

    const entry = {
      ...createEntry(undefined),
      scanError: "NFO 解析失败: NFO missing website",
    };
    const preview: MaintenancePreviewItem = {
      fileId: entry.fileId,
      status: "ready",
      proposedCrawlerData: createCrawlerData({
        title: "Remote Title",
        title_zh: "远程标题",
        plot: "Remote Plot",
        poster_url: "https://example.com/poster.jpg",
      }),
    };

    expect(toDetailViewItemFromMaintenanceEntry(entry, preview)).toMatchObject({
      id: "entry-1",
      status: "success",
      minimalErrorView: false,
      title: "远程标题",
      plot: "Remote Plot",
      posterUrl: "/media/poster.jpg",
      outputPath: "/media",
    });
  });
});
