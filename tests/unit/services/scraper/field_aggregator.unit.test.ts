import { FieldAggregator } from "@mdcz/runtime/scrape";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import { describe, expect, it } from "vitest";

const makeCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Test Title",
  number: "ABF-075",
  actors: ["Actor A"],
  genres: ["Genre A"],
  scene_images: [],
  website: Website.DMM,
  ...overrides,
});

describe("FieldAggregator", () => {
  it("applies first_non_null priority and fallback rules", () => {
    const cases = [
      {
        aggregator: new FieldAggregator({
          title: [Website.JAVDB, Website.DMM],
        }),
        results: new Map<Website, CrawlerData>([
          [Website.DMM, makeCrawlerData({ title: "DMM Title", website: Website.DMM })],
          [Website.JAVDB, makeCrawlerData({ title: "JAVDB Title", website: Website.JAVDB })],
        ]),
        field: "title",
        expectedValue: "JAVDB Title",
        expectedSource: Website.JAVDB,
      },
      {
        aggregator: new FieldAggregator({
          studio: [Website.JAVDB, Website.DMM],
        }),
        results: new Map<Website, CrawlerData>([
          [Website.DMM, makeCrawlerData({ studio: "DMM Studio", website: Website.DMM })],
          [Website.JAVDB, makeCrawlerData({ studio: undefined, website: Website.JAVDB })],
        ]),
        field: "studio",
        expectedValue: "DMM Studio",
        expectedSource: Website.DMM,
      },
      {
        aggregator: new FieldAggregator({
          plot: [Website.OFFICIAL, Website.DMM],
        }),
        results: new Map<Website, CrawlerData>([
          [Website.DMM, makeCrawlerData({ plot: "A longer plot with masked 犯●れ", website: Website.DMM })],
          [Website.JAVDB, makeCrawlerData({ plot: "<script>var x = 1;</script>", website: Website.JAVDB })],
          [Website.OFFICIAL, makeCrawlerData({ plot: "犯され", website: Website.OFFICIAL })],
        ]),
        field: "plot",
        expectedValue: "犯され",
        expectedSource: Website.OFFICIAL,
      },
      {
        aggregator: new FieldAggregator({
          plot: [Website.JAVDB, Website.DMM],
        }),
        results: new Map<Website, CrawlerData>([
          [Website.DMM, makeCrawlerData({ plot: "DMM plot", website: Website.DMM })],
          [Website.JAVDB, makeCrawlerData({ plot: "<script>var x = 1;</script>", website: Website.JAVDB })],
        ]),
        field: "plot",
        expectedValue: "DMM plot",
        expectedSource: Website.DMM,
      },
    ];

    for (const { aggregator, results, field, expectedValue, expectedSource } of cases) {
      const { data, sources } = aggregator.aggregate(results);

      expect(data[field as keyof CrawlerData]).toBe(expectedValue);
      expect(sources[field as keyof CrawlerData]).toBe(expectedSource);
    }
  });

  it("merges actors across sites by identity and picks genres by priority", () => {
    const renamed = new Map<Website, CrawlerData>([
      [Website.DMM_TV, makeCrawlerData({ actors: ["及川美桜（夏生なつ）"], website: Website.DMM_TV })],
      [Website.AVBASE, makeCrawlerData({ actors: ["夏生なつ"], website: Website.AVBASE })],
    ]);
    const cases = [
      {
        priorities: { actors: [Website.AVBASE, Website.JAVBUS, Website.JAVDB] },
        results: new Map<Website, CrawlerData>([
          [Website.JAVBUS, makeCrawlerData({ actors: ["女优 A", "女优 D"], website: Website.JAVBUS })],
          [Website.AVBASE, makeCrawlerData({ actors: [], website: Website.AVBASE })],
          [Website.JAVDB, makeCrawlerData({ actors: ["女优A", "女优 C"], website: Website.JAVDB })],
        ]),
        field: "actors",
        expectedValue: ["女优 A", "女优 D", "女优 C"],
        expectedSource: Website.JAVBUS,
      },
      {
        priorities: { actors: [Website.AVBASE, Website.DMM_TV] },
        results: renamed,
        field: "actors",
        expectedValue: ["夏生なつ"],
        expectedSource: Website.AVBASE,
      },
      {
        priorities: { actors: [Website.DMM_TV, Website.AVBASE] },
        results: renamed,
        field: "actors",
        expectedValue: ["及川美桜（夏生なつ）"],
        expectedSource: Website.DMM_TV,
      },
      {
        priorities: { genres: [Website.JAVDB, Website.DMM] },
        results: new Map<Website, CrawlerData>([
          [Website.DMM, makeCrawlerData({ genres: ["単体作品", "ドラマ"], website: Website.DMM })],
          [Website.JAVDB, makeCrawlerData({ genres: ["單體作品"], website: Website.JAVDB })],
        ]),
        field: "genres",
        expectedValue: ["單體作品"],
        expectedSource: Website.JAVDB,
      },
    ];

    for (const { priorities, results, field, expectedValue, expectedSource } of cases) {
      const { data, sources } = new FieldAggregator(priorities).aggregate(results);

      expect(data[field as keyof CrawlerData]).toEqual(expectedValue);
      expect(sources[field as keyof CrawlerData]).toBe(expectedSource);
    }
  });

  it("keeps scene images as a single source set and preserves fallback sets separately", () => {
    const aggregator = new FieldAggregator({});
    const results = new Map<Website, CrawlerData>([
      [Website.DMM, makeCrawlerData({ scene_images: ["https://a.jpg", "https://b.jpg"], website: Website.DMM })],
      [Website.JAVDB, makeCrawlerData({ scene_images: ["https://b.jpg", "https://c.jpg"], website: Website.JAVDB })],
    ]);

    const { data, imageAlternatives, sources } = aggregator.aggregate(results);

    expect(data.scene_images).toEqual(["https://a.jpg", "https://b.jpg"]);
    expect(imageAlternatives.scene_images).toEqual([["https://b.jpg", "https://c.jpg"]]);
    expect(imageAlternatives.scene_images_source).toBe(Website.DMM);
    expect(imageAlternatives.scene_image_sources).toEqual([Website.JAVDB]);
    expect(sources.scene_images).toBe(Website.DMM);
  });

  it("respects maxActors limit", () => {
    const aggregator = new FieldAggregator({}, { maxActors: 2 });
    const results = new Map<Website, CrawlerData>([
      [Website.DMM, makeCrawlerData({ actors: ["A", "B", "C", "D"], website: Website.DMM })],
    ]);

    const { data } = aggregator.aggregate(results);
    expect(data.actors).toHaveLength(2);
  });

  it("prefers higher-quality thumb URLs without ignoring configured fallback order", () => {
    const aggregator = new FieldAggregator({
      thumb_url: [Website.JAVDB, Website.DMM],
    });
    const cases = [
      {
        results: new Map<Website, CrawlerData>([
          [Website.DMM, makeCrawlerData({ thumb_url: "https://awsimgsrc.dmm.co.jp/thumb.jpg", website: Website.DMM })],
          [Website.JAVDB, makeCrawlerData({ thumb_url: "https://javdb.com/thumb.jpg", website: Website.JAVDB })],
        ]),
        expectedThumb: "https://awsimgsrc.dmm.co.jp/thumb.jpg",
        expectedSource: Website.DMM,
      },
      {
        results: new Map<Website, CrawlerData>([
          [Website.DMM, makeCrawlerData({ thumb_url: "https://dmm.co.jp/thumb.jpg", website: Website.DMM })],
          [Website.JAVDB, makeCrawlerData({ thumb_url: "https://javdb.com/thumb.jpg", website: Website.JAVDB })],
        ]),
        expectedThumb: "https://javdb.com/thumb.jpg",
        expectedSource: Website.JAVDB,
      },
    ];

    for (const { results, expectedThumb, expectedSource } of cases) {
      const { data, sources } = aggregator.aggregate(results);

      expect(data.thumb_url).toBe(expectedThumb);
      expect(sources.thumb_url).toBe(expectedSource);
    }
  });

  it("throws when no results are provided", () => {
    expect(() => new FieldAggregator({}).aggregate(new Map())).toThrow("No results to aggregate");
  });
});
