import { Website } from "@shared/enums";
import type { CrawlerData, LocalScanEntry, MaintenancePreviewItem } from "@shared/types";
import { describe, expect, it } from "vitest";
import { buildCommittedCrawlerData, buildMaintenanceCommitItem } from "@/lib/maintenance";

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Old Title",
  title_zh: "旧标题",
  number: "ABC-123",
  actors: ["Actor A"],
  genres: ["Drama"],
  sample_images: ["https://example.com/old-scene.jpg"],
  website: Website.DMM,
  ...overrides,
});

const createEntry = (crawlerData: CrawlerData): LocalScanEntry => ({
  id: "entry-1",
  videoPath: "/media/ABC-123.mp4",
  fileInfo: {
    filePath: "/media/ABC-123.mp4",
    fileName: "ABC-123.mp4",
    extension: ".mp4",
    number: "ABC-123",
    isSubtitled: false,
  },
  nfoPath: "/media/ABC-123.nfo",
  crawlerData,
  assets: {
    poster: "/media/poster.jpg",
    thumb: "/media/thumb.jpg",
    fanart: "/media/fanart.jpg",
    sceneImages: ["/media/extrafanart/fanart1.jpg"],
    trailer: "/media/trailer.mp4",
    nfo: "/media/ABC-123.nfo",
    actorPhotos: ["/media/.actors/Actor A.jpg"],
  },
  currentDir: "/media",
});

describe("buildCommittedCrawlerData", () => {
  it("merges selected old and new diff values onto the existing crawler data", () => {
    const entry = createEntry(createCrawlerData());
    const preview: MaintenancePreviewItem = {
      entryId: entry.id,
      status: "ready",
      proposedCrawlerData: createCrawlerData({
        title: "New Title",
        title_zh: "新标题",
        genres: ["Drama", "Mystery"],
      }),
      fieldDiffs: [
        { field: "title", label: "标题", oldValue: "Old Title", newValue: "New Title", changed: true },
        { field: "title_zh", label: "中文标题", oldValue: "旧标题", newValue: "新标题", changed: true },
        { field: "genres", label: "标签", oldValue: ["Drama"], newValue: ["Drama", "Mystery"], changed: true },
      ],
    };

    const committed = buildCommittedCrawlerData(entry, preview, {
      title: "old",
      title_zh: "new",
      genres: "new",
    });

    expect(committed).toMatchObject({
      title: "Old Title",
      title_zh: "新标题",
      genres: ["Drama", "Mystery"],
      number: "ABC-123",
    });
  });
});

describe("buildMaintenanceCommitItem", () => {
  it("keeps image alternatives only for fields that still use the preview value", () => {
    const entry = createEntry(
      createCrawlerData({
        poster_url: "https://example.com/old-poster.jpg",
        thumb_url: "https://example.com/old-thumb.jpg",
      }),
    );
    const preview: MaintenancePreviewItem = {
      entryId: entry.id,
      status: "ready",
      proposedCrawlerData: createCrawlerData({
        poster_url: "https://example.com/new-poster.jpg",
        thumb_url: "https://example.com/new-thumb.jpg",
      }),
      imageAlternatives: {
        poster_url: ["https://example.com/poster-alt.jpg"],
        thumb_url: ["https://example.com/thumb-alt.jpg"],
      },
      fieldDiffs: [
        {
          field: "poster_url",
          label: "海报",
          oldValue: "https://example.com/old-poster.jpg",
          newValue: "https://example.com/new-poster.jpg",
          changed: true,
        },
        {
          field: "thumb_url",
          label: "封面图",
          oldValue: "https://example.com/old-thumb.jpg",
          newValue: "https://example.com/new-thumb.jpg",
          changed: true,
        },
      ],
    };

    const item = buildMaintenanceCommitItem(entry, preview, {
      poster_url: "old",
      thumb_url: "new",
    });

    expect(item.crawlerData?.poster_url).toBe("https://example.com/old-poster.jpg");
    expect(item.crawlerData?.thumb_url).toBe("https://example.com/new-thumb.jpg");
    expect(item.imageAlternatives).toEqual({
      thumb_url: ["https://example.com/thumb-alt.jpg"],
    });
  });
});
