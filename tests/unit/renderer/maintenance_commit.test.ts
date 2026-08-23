import type { LocalScanEntry, MaintenancePreviewItem } from "@mdcz/shared/types";
import { describe, expect, it } from "vitest";
import {
  buildCommittedCrawlerData,
  buildMaintenanceApplyCommit,
  resolveMaintenanceDiffImageOption,
  resolveMaintenanceDiffImageSrc,
} from "@/lib/maintenance";
import {
  createMaintenanceCrawlerData,
  createMaintenanceEntry,
  createMaintenanceImageCollectionDiff,
  createMaintenanceImageDiff,
  createMaintenanceValueDiff,
} from "./maintenanceTestSupport";

describe("buildCommittedCrawlerData", () => {
  it("merges selected old and new diff values onto the existing crawler data", () => {
    const entry = createMaintenanceEntry(createMaintenanceCrawlerData());
    const preview: MaintenancePreviewItem = {
      fileId: entry.fileId,
      status: "ready",
      proposedCrawlerData: createMaintenanceCrawlerData({
        title: "New Title",
        title_zh: "新标题",
        genres: ["Drama", "Mystery"],
      }),
      fieldDiffs: [
        createMaintenanceValueDiff({
          field: "title",
          label: "标题",
          oldValue: "Old Title",
          newValue: "New Title",
          changed: true,
        }),
        createMaintenanceValueDiff({
          field: "title_zh",
          label: "中文标题",
          oldValue: "旧标题",
          newValue: "新标题",
          changed: true,
        }),
        createMaintenanceValueDiff({
          field: "genres",
          label: "标签",
          oldValue: ["Drama"],
          newValue: ["Drama", "Mystery"],
          changed: true,
        }),
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

describe("buildMaintenanceApplyCommit", () => {
  it("keeps only selected preview image alternatives and derives asset decisions from the chosen side", () => {
    const entry = createMaintenanceEntry(
      createMaintenanceCrawlerData({
        poster_url: "https://example.com/old-poster.jpg",
        thumb_url: "https://example.com/old-thumb.jpg",
        poster_source_url: "https://example.com/old-poster.jpg",
        thumb_source_url: "https://example.com/old-thumb.jpg",
      }),
    );
    const preview: MaintenancePreviewItem = {
      fileId: entry.fileId,
      status: "ready",
      proposedCrawlerData: createMaintenanceCrawlerData({
        poster_url: "https://example.com/new-poster.jpg",
        thumb_url: "https://example.com/new-thumb.jpg",
      }),
      imageAlternatives: {
        poster_url: ["https://example.com/poster-alt.jpg"],
        thumb_url: ["https://example.com/thumb-alt.jpg"],
      },
      fieldDiffs: [
        createMaintenanceImageDiff({
          field: "poster_url",
          label: "海报",
          oldValue: "https://example.com/old-poster.jpg",
          newValue: "https://example.com/new-poster.jpg",
          changed: true,
          oldPreview: {
            src: "/media/poster.jpg",
            fallbackSrcs: [],
          },
          newPreview: {
            src: "https://example.com/new-poster.jpg",
            fallbackSrcs: ["https://example.com/poster-alt.jpg"],
          },
        }),
        createMaintenanceImageDiff({
          field: "thumb_url",
          label: "封面图",
          oldValue: "https://example.com/old-thumb.jpg",
          newValue: "https://example.com/new-thumb.jpg",
          changed: true,
          oldPreview: {
            src: "/media/thumb.jpg",
            fallbackSrcs: [],
          },
          newPreview: {
            src: "https://example.com/new-thumb.jpg",
            fallbackSrcs: ["https://example.com/thumb-alt.jpg"],
          },
        }),
      ],
    };

    const item = buildMaintenanceApplyCommit(entry, preview, {
      poster_url: "old",
      thumb_url: "new",
    });

    expect(item.crawlerData?.poster_url).toBe("https://example.com/old-poster.jpg");
    expect(item.crawlerData?.thumb_url).toBe("https://example.com/new-thumb.jpg");
    expect(item.crawlerData?.fanart_url).toBeUndefined();
    expect(item.crawlerData?.poster_source_url).toBe("https://example.com/old-poster.jpg");
    expect(item.crawlerData?.thumb_source_url).toBe("https://example.com/new-thumb.jpg");
    expect(item.crawlerData?.fanart_source_url).toBe("https://example.com/new-thumb.jpg");
    expect(item.imageAlternatives).toEqual({
      thumb_url: ["https://example.com/thumb-alt.jpg"],
    });
    expect(item.assetDecisions).toEqual({
      fanart: "replace",
    });

    const sceneEntry = createMaintenanceEntry(
      createMaintenanceCrawlerData({
        scene_images: [],
      }),
    );
    const scenePreview: MaintenancePreviewItem = {
      fileId: sceneEntry.fileId,
      status: "ready",
      proposedCrawlerData: createMaintenanceCrawlerData({
        scene_images: ["https://example.com/new-scene.jpg"],
      }),
      fieldDiffs: [
        createMaintenanceImageCollectionDiff({
          field: "scene_images",
          label: "剧照",
          oldValue: [],
          newValue: ["https://example.com/new-scene.jpg"],
          changed: true,
          oldPreview: {
            items: ["/media/extrafanart/fanart1.jpg"],
          },
          newPreview: {
            items: ["https://example.com/new-scene.jpg"],
          },
        }),
      ],
    };

    const sceneItem = buildMaintenanceApplyCommit(sceneEntry, scenePreview, {
      scene_images: "old",
    });

    expect(sceneItem.crawlerData?.scene_images).toEqual([]);
    expect(sceneItem.assetDecisions).toEqual({
      sceneImages: "preserve",
    });

    const remoteEntry = createMaintenanceEntry(
      createMaintenanceCrawlerData({
        trailer_url: "https://example.com/trailer-old.mp4",
        trailer_source_url: "https://example.com/trailer-old.mp4",
      }),
    );
    const remotePreview: MaintenancePreviewItem = {
      fileId: remoteEntry.fileId,
      status: "ready",
      proposedCrawlerData: createMaintenanceCrawlerData({
        trailer_url: "https://example.com/trailer-new.mp4",
        trailer_source_url: "https://example.com/trailer-new.mp4",
      }),
      fieldDiffs: [
        createMaintenanceValueDiff({
          field: "trailer_url",
          label: "预告片",
          oldValue: "https://example.com/trailer-old.mp4",
          newValue: "https://example.com/trailer-new.mp4",
          changed: true,
        }),
      ],
    };

    const replacedTrailer = buildMaintenanceApplyCommit(remoteEntry, remotePreview, {
      trailer_url: "new",
    });

    expect(replacedTrailer.crawlerData?.trailer_url).toBe("https://example.com/trailer-new.mp4");
    expect(replacedTrailer.crawlerData?.trailer_source_url).toBe("https://example.com/trailer-new.mp4");
    expect(replacedTrailer.assetDecisions).toEqual({
      trailer: "replace",
    });

    const localEntry: LocalScanEntry = {
      ...createMaintenanceEntry(),
      scanError: "NFO 解析失败: NFO missing website",
    };
    const localPreview: MaintenancePreviewItem = {
      fileId: localEntry.fileId,
      status: "ready",
      proposedCrawlerData: createMaintenanceCrawlerData({
        trailer_url: "https://example.com/trailer-new.mp4",
        trailer_source_url: "https://example.com/trailer-new.mp4",
      }),
      fieldDiffs: [
        createMaintenanceValueDiff({
          field: "trailer_url",
          label: "预告片",
          oldValue: "trailer.mp4",
          newValue: "https://example.com/trailer-new.mp4",
          changed: true,
        }),
      ],
    };

    const preservedTrailer = buildMaintenanceApplyCommit(localEntry, localPreview, {
      trailer_url: "old",
    });

    expect(preservedTrailer.crawlerData?.trailer_url).toBe("trailer.mp4");
    expect(preservedTrailer.crawlerData?.trailer_source_url).toBeUndefined();
    expect(preservedTrailer.assetDecisions).toEqual({
      trailer: "preserve",
    });
  });

  it("replays selected local poster and thumb assets when NFO parsing failed", () => {
    const entry: LocalScanEntry = {
      ...createMaintenanceEntry(),
      scanError: "NFO 解析失败: NFO missing website",
    };
    const preview: MaintenancePreviewItem = {
      fileId: entry.fileId,
      status: "ready",
      proposedCrawlerData: createMaintenanceCrawlerData({
        poster_url: "https://example.com/new-poster.jpg",
        poster_source_url: "https://example.com/new-poster.jpg",
        thumb_url: "https://example.com/new-thumb.jpg",
        thumb_source_url: "https://example.com/new-thumb.jpg",
        fanart_source_url: "https://example.com/new-thumb.jpg",
      }),
      fieldDiffs: [
        createMaintenanceImageDiff({
          field: "poster_url",
          label: "海报",
          oldValue: "",
          newValue: "https://example.com/new-poster.jpg",
          changed: true,
          oldPreview: {
            src: "/media/poster.jpg",
            fallbackSrcs: [],
          },
          newPreview: {
            src: "https://example.com/new-poster.jpg",
            fallbackSrcs: [],
          },
        }),
        createMaintenanceImageDiff({
          field: "thumb_url",
          label: "封面图",
          oldValue: "",
          newValue: "https://example.com/new-thumb.jpg",
          changed: true,
          oldPreview: {
            src: "/media/thumb.jpg",
            fallbackSrcs: [],
          },
          newPreview: {
            src: "https://example.com/new-thumb.jpg",
            fallbackSrcs: [],
          },
        }),
      ],
    };

    const item = buildMaintenanceApplyCommit(entry, preview, {
      poster_url: "old",
      thumb_url: "old",
    });

    expect(item.crawlerData?.poster_url).toBe("poster.jpg");
    expect(item.crawlerData?.thumb_url).toBe("thumb.jpg");
    expect(item.crawlerData?.poster_source_url).toBeUndefined();
    expect(item.crawlerData?.thumb_source_url).toBeUndefined();
    expect(item.crawlerData?.fanart_url).toBeUndefined();
    expect(item.crawlerData?.fanart_source_url).toBeUndefined();
    expect(item.assetDecisions).toEqual({
      fanart: "preserve",
    });
  });
});

describe("resolveMaintenanceDiffImageSrc", () => {
  it("prefers discovered local artwork and falls back to thumb-based fanart previews", () => {
    const posterDiff = createMaintenanceImageDiff({
      field: "poster_url",
      label: "海报",
      oldValue: "poster.jpg",
      newValue: "https://example.com/new-poster.jpg",
      changed: true,
      oldPreview: {
        src: "/media/poster.jpg",
        fallbackSrcs: [],
      },
      newPreview: {
        src: "https://example.com/new-poster.jpg",
        fallbackSrcs: [],
      },
    });

    expect(resolveMaintenanceDiffImageSrc(posterDiff, "old")).toBe("/media/poster.jpg");
    expect(resolveMaintenanceDiffImageSrc(posterDiff, "new")).toBe("https://example.com/new-poster.jpg");

    const fanartDiff = createMaintenanceImageDiff({
      field: "fanart_url",
      label: "背景图",
      oldValue: undefined,
      newValue: "https://example.com/new-fanart.jpg",
      changed: true,
      oldPreview: {
        src: "/media/fanart.jpg",
        fallbackSrcs: [],
      },
      newPreview: {
        src: "https://example.com/new-fanart.jpg",
        fallbackSrcs: [],
      },
    });

    expect(resolveMaintenanceDiffImageSrc(fanartDiff, "old")).toBe("/media/fanart.jpg");

    const thumbFallbackDiff = createMaintenanceImageDiff({
      field: "fanart_url",
      label: "背景图",
      oldValue: undefined,
      newValue: undefined,
      changed: true,
      oldPreview: {
        src: "/media/thumb.jpg",
        fallbackSrcs: [],
      },
      newPreview: {
        src: "https://example.com/new-thumb.jpg",
        fallbackSrcs: ["https://example.com/new-thumb-alt.jpg"],
      },
    });

    expect(resolveMaintenanceDiffImageOption(thumbFallbackDiff, "old")).toEqual({
      src: "/media/thumb.jpg",
      fallbackSrcs: [],
    });
    expect(resolveMaintenanceDiffImageOption(thumbFallbackDiff, "new")).toEqual({
      src: "https://example.com/new-thumb.jpg",
      fallbackSrcs: ["https://example.com/new-thumb-alt.jpg"],
    });
  });
});
