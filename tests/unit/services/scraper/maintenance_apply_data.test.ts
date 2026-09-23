import {
  buildCommittedCrawlerData,
  buildMaintenanceApplyData,
  getDefaultMaintenanceFieldSelection,
  resolveMaintenanceDiffImageCollection,
  resolveMaintenanceDiffImageOption,
  resolveMaintenanceDiffImageSrc,
} from "@mdcz/runtime/maintenance";
import type { LocalScanEntry, MaintenancePreviewItem } from "@mdcz/shared/types";
import { describe, expect, it } from "vitest";
import {
  createMaintenanceCrawlerData,
  createMaintenanceEntry,
  createMaintenanceImageCollectionDiff,
  createMaintenanceImageDiff,
  createMaintenanceValueDiff,
} from "../../renderer/maintenanceTestSupport";

describe("buildCommittedCrawlerData", () => {
  it("merges selected old and new diff values onto existing crawler data", () => {
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

  it("returns base data directly when preview has no field diffs", () => {
    const entry = createMaintenanceEntry(createMaintenanceCrawlerData());
    const preview: MaintenancePreviewItem = {
      fileId: entry.fileId,
      status: "ready",
      proposedCrawlerData: createMaintenanceCrawlerData({ title: "Other" }),
    };

    const committed = buildCommittedCrawlerData(entry, preview, undefined);
    expect(committed?.title).toBe("Old Title");
  });

  it("returns undefined when neither entry nor preview has crawler data", () => {
    const entry = createMaintenanceEntry(undefined);
    expect(buildCommittedCrawlerData(entry, undefined, undefined)).toBeUndefined();
  });
});

describe("buildMaintenanceApplyData", () => {
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

    const item = buildMaintenanceApplyData(entry, preview, {
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
      thumb: "replace",
      poster: "preserve",
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
      imageAlternatives: {
        scene_images: [["https://example.com/new-scene.jpg"]],
      },
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

    const preservedScene = buildMaintenanceApplyData(sceneEntry, scenePreview, {
      scene_images: "old",
    });

    expect(preservedScene.crawlerData?.scene_images).toEqual([]);
    expect(preservedScene.imageAlternatives).toBeUndefined();
    expect(preservedScene.assetDecisions).toEqual({
      sceneImages: "preserve",
    });

    const replacedScene = buildMaintenanceApplyData(sceneEntry, scenePreview, {
      scene_images: "new",
    });
    expect(replacedScene.crawlerData?.scene_images).toEqual(["https://example.com/new-scene.jpg"]);
    expect(replacedScene.imageAlternatives).toEqual({
      scene_images: [["https://example.com/new-scene.jpg"]],
    });
    expect(replacedScene.assetDecisions).toEqual({
      sceneImages: "replace",
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

    const replacedTrailer = buildMaintenanceApplyData(remoteEntry, remotePreview, {
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

    const preservedTrailer = buildMaintenanceApplyData(localEntry, localPreview, {
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

    const item = buildMaintenanceApplyData(entry, preview, {
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
      thumb: "preserve",
      poster: "preserve",
      fanart: "preserve",
    });
  });
});

describe("resolveMaintenanceDiffImageSrc & resolveMaintenanceDiffImageOption", () => {
  it("resolves old vs new preview src and fallback lists for image diffs", () => {
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
        fallbackSrcs: ["https://example.com/poster-alt.jpg"],
      },
    });

    expect(resolveMaintenanceDiffImageSrc(posterDiff, "old")).toBe("/media/poster.jpg");
    expect(resolveMaintenanceDiffImageSrc(posterDiff, "new")).toBe("https://example.com/new-poster.jpg");
    expect(resolveMaintenanceDiffImageOption(posterDiff, "new")).toEqual({
      src: "https://example.com/new-poster.jpg",
      fallbackSrcs: ["https://example.com/poster-alt.jpg"],
    });

    const valueDiff = createMaintenanceValueDiff({
      field: "title",
      label: "标题",
      oldValue: "Old",
      newValue: "New",
      changed: true,
    });
    expect(resolveMaintenanceDiffImageSrc(valueDiff, "old")).toBe("");
    expect(resolveMaintenanceDiffImageOption(valueDiff, "old")).toEqual({
      src: "",
      fallbackSrcs: [],
    });
  });

  it("resolves image collection items", () => {
    const collectionDiff = createMaintenanceImageCollectionDiff({
      field: "scene_images",
      label: "剧照",
      oldValue: [],
      newValue: ["https://example.com/scene1.jpg"],
      changed: true,
      oldPreview: {
        items: ["/media/fanart1.jpg"],
      },
      newPreview: {
        items: ["https://example.com/scene1.jpg"],
      },
    });

    expect(resolveMaintenanceDiffImageCollection(collectionDiff, "old")).toEqual(["/media/fanart1.jpg"]);
    expect(resolveMaintenanceDiffImageCollection(collectionDiff, "new")).toEqual(["https://example.com/scene1.jpg"]);

    const valueDiff = createMaintenanceValueDiff({
      field: "title",
      label: "标题",
      oldValue: "A",
      newValue: "B",
      changed: true,
    });
    expect(resolveMaintenanceDiffImageCollection(valueDiff, "old")).toEqual([]);
  });
});

describe("getDefaultMaintenanceFieldSelection", () => {
  it("prefers old when only old has value, otherwise new", () => {
    const onlyOldDiff = createMaintenanceValueDiff({
      field: "plot",
      label: "剧情介绍",
      oldValue: "Existing outline",
      newValue: "",
      changed: true,
    });
    expect(getDefaultMaintenanceFieldSelection(onlyOldDiff)).toBe("old");

    const onlyNewDiff = createMaintenanceValueDiff({
      field: "plot",
      label: "剧情介绍",
      oldValue: "",
      newValue: "New outline",
      changed: true,
    });
    expect(getDefaultMaintenanceFieldSelection(onlyNewDiff)).toBe("new");

    const bothDiff = createMaintenanceValueDiff({
      field: "plot",
      label: "剧情介绍",
      oldValue: "Old outline",
      newValue: "New outline",
      changed: true,
    });
    expect(getDefaultMaintenanceFieldSelection(bothDiff)).toBe("new");
  });
});
