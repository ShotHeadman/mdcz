import {
  diffCrawlerData,
  diffCrawlerDataWithOptions,
  partitionCrawlerDataWithOptions,
} from "@main/services/scraper/maintenance/diffCrawlerData";
import { Website } from "@shared/enums";
import type { CrawlerData, LocalScanEntry } from "@shared/types";
import { describe, expect, it } from "vitest";

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Sample Title",
  number: "ABC-123",
  actors: ["Actor A"],
  actor_profiles: [{ name: "Actor A", photo_url: ".actors/Actor A.jpg" }],
  genres: [],
  sample_images: [],
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
    actorPhotos: [],
  },
  currentDir: "/media",
});

describe("diffCrawlerData", () => {
  it("ignores actor thumbnail path changes because actor_profiles are execution-time derived data", () => {
    const diffs = diffCrawlerData(
      createCrawlerData({
        actor_profiles: [{ name: "Actor A", photo_url: ".actors/Actor A.jpg" }],
      }),
      createCrawlerData({
        actor_profiles: [{ name: "Actor A", photo_url: "https://example.com/actor-a.png" }],
      }),
    );

    expect(diffs).toEqual([]);
  });

  it("still reports actor list changes through the actors field", () => {
    const diffs = diffCrawlerData(
      createCrawlerData({
        actors: ["Actor A"],
        actor_profiles: [{ name: "Actor A", photo_url: ".actors/Actor A.jpg" }],
      }),
      createCrawlerData({
        actors: ["Actor A", "Actor B"],
        actor_profiles: [
          { name: "Actor A", photo_url: ".actors/Actor A.jpg" },
          { name: "Actor B", photo_url: "https://example.com/actor-b.png" },
        ],
      }),
    );

    expect(diffs).toEqual([
      {
        kind: "value",
        field: "actors",
        label: "演员",
        oldValue: ["Actor A"],
        newValue: ["Actor A", "Actor B"],
        changed: true,
      },
    ]);
  });

  it("skips translated fields when translation is disabled for maintenance preview", () => {
    const diffs = diffCrawlerDataWithOptions(
      createCrawlerData({
        title: "Original Title",
        title_zh: "旧中文标题",
        plot: "Original Plot",
        plot_zh: "旧中文简介",
      }),
      createCrawlerData({
        title: "Original Title",
        title_zh: undefined,
        plot: "Original Plot",
        plot_zh: undefined,
      }),
      {
        includeTranslatedFields: false,
      },
    );

    expect(diffs).toEqual([]);
  });

  it("collects unchanged non-empty fields separately for maintenance display", () => {
    const result = partitionCrawlerDataWithOptions(
      createCrawlerData({
        title: "Original Title",
        plot: "Original Plot",
      }),
      createCrawlerData({
        title: "Original Title",
        plot: "Original Plot",
        studio: "New Studio",
      }),
      {},
    );

    expect(result.fieldDiffs).toEqual([
      {
        kind: "value",
        field: "studio",
        label: "制片",
        oldValue: undefined,
        newValue: "New Studio",
        changed: true,
      },
    ]);
    expect(result.unchangedFieldDiffs).toEqual([
      {
        kind: "value",
        field: "title",
        label: "标题",
        oldValue: "Original Title",
        newValue: "Original Title",
        changed: false,
      },
      {
        kind: "value",
        field: "plot",
        label: "简介",
        oldValue: "Original Plot",
        newValue: "Original Plot",
        changed: false,
      },
      {
        kind: "value",
        field: "actors",
        label: "演员",
        oldValue: ["Actor A"],
        newValue: ["Actor A"],
        changed: false,
      },
    ]);
  });

  it("emits a thumb diff and omits background diff when thumb replacement also drives fanart", () => {
    const entry = createEntry(
      createCrawlerData({
        thumb_url: "thumb.jpg",
        fanart_url: undefined,
      }),
    );
    const existingCrawlerData = entry.crawlerData;

    expect(existingCrawlerData).toBeDefined();
    if (!existingCrawlerData) {
      throw new Error("Expected crawler data for maintenance diff test");
    }

    const result = partitionCrawlerDataWithOptions(
      existingCrawlerData,
      createCrawlerData({
        thumb_url: "https://example.com/new-thumb.jpg",
        fanart_url: undefined,
      }),
      {
        entry,
        imageAlternatives: {
          thumb_url: ["https://example.com/new-thumb-alt.jpg"],
        },
      },
    );

    expect(result.fieldDiffs).toContainEqual({
      kind: "image",
      field: "thumb_url",
      label: "封面图",
      oldValue: "thumb.jpg",
      newValue: "https://example.com/new-thumb.jpg",
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
    expect(result.fieldDiffs.find((diff) => diff.field === "fanart_url")).toBeUndefined();
  });

  it("diffs release_date without surfacing a separate release_year field", () => {
    const result = partitionCrawlerDataWithOptions(
      createCrawlerData({
        release_date: "2023-05-06",
      }),
      createCrawlerData({
        release_date: "2024-01-02",
      }),
      {},
    );

    expect(result.fieldDiffs).toEqual([
      {
        kind: "value",
        field: "release_date",
        label: "发行日期",
        oldValue: "2023-05-06",
        newValue: "2024-01-02",
        changed: true,
      },
    ]);
  });

  it("treats an image as unchanged when the preserved old remote source matches the new candidate url", () => {
    const entry = createEntry(
      createCrawlerData({
        thumb_url: "thumb.jpg",
        thumb_source_url: "https://example.com/current-thumb.jpg",
      }),
    );
    const existingCrawlerData = entry.crawlerData;

    expect(existingCrawlerData).toBeDefined();
    if (!existingCrawlerData) {
      throw new Error("Expected crawler data for maintenance diff test");
    }

    const result = partitionCrawlerDataWithOptions(
      existingCrawlerData,
      createCrawlerData({
        thumb_url: "https://example.com/current-thumb.jpg",
      }),
      {
        entry,
      },
    );

    expect(result.fieldDiffs.find((diff) => diff.field === "thumb_url")).toBeUndefined();
    expect(result.unchangedFieldDiffs).toContainEqual({
      kind: "image",
      field: "thumb_url",
      label: "封面图",
      oldValue: "thumb.jpg",
      newValue: "https://example.com/current-thumb.jpg",
      changed: false,
      oldPreview: {
        src: "/media/thumb.jpg",
        fallbackSrcs: [],
      },
      newPreview: {
        src: "https://example.com/current-thumb.jpg",
        fallbackSrcs: [],
      },
    });
  });

  it("emits a scene-image diff from local extrafanart even when old raw urls are empty", () => {
    const entry = createEntry(
      createCrawlerData({
        sample_images: [],
      }),
    );
    const existingCrawlerData = entry.crawlerData;

    expect(existingCrawlerData).toBeDefined();
    if (!existingCrawlerData) {
      throw new Error("Expected crawler data for maintenance diff test");
    }

    const result = partitionCrawlerDataWithOptions(
      existingCrawlerData,
      createCrawlerData({
        sample_images: ["https://example.com/new-scene.jpg"],
      }),
      {
        entry,
      },
    );

    expect(result.fieldDiffs).toContainEqual({
      kind: "imageCollection",
      field: "sample_images",
      label: "场景图",
      oldValue: [],
      newValue: ["https://example.com/new-scene.jpg"],
      changed: true,
      oldPreview: {
        items: ["/media/extrafanart/fanart1.jpg"],
      },
      newPreview: {
        items: ["https://example.com/new-scene.jpg"],
      },
    });
  });
});
