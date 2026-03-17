import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { CrawlerProvider, FetchGateway } from "@main/services/crawler";
import type { CrawlerInput, CrawlerResponse } from "@main/services/crawler/base/types";
import { NetworkClient } from "@main/services/network";
import { AggregationService } from "@main/services/scraper/aggregation/AggregationService";
import { FieldAggregator } from "@main/services/scraper/aggregation/FieldAggregator";
import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import { describe, expect, it } from "vitest";

// ── Test data factories ──

const makeCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Test Title",
  number: "ABF-075",
  actors: ["Actor A"],
  genres: ["Genre A"],
  sample_images: [],
  website: Website.DMM,
  ...overrides,
});

const waitForDelay = async (delayMs: number, signal?: AbortSignal): Promise<void> => {
  if (delayMs <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);

    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
};

// ── FieldAggregator unit tests ──

describe("FieldAggregator", () => {
  describe("first_non_null strategy", () => {
    it("returns value from highest-priority source", () => {
      const aggregator = new FieldAggregator({
        title: [Website.JAVDB, Website.DMM],
      });

      const results = new Map<Website, CrawlerData>([
        [Website.DMM, makeCrawlerData({ title: "DMM Title", website: Website.DMM })],
        [Website.JAVDB, makeCrawlerData({ title: "JAVDB Title", website: Website.JAVDB })],
      ]);

      const { data, sources } = aggregator.aggregate(results);
      expect(data.title).toBe("JAVDB Title");
      expect(sources.title).toBe(Website.JAVDB);
    });

    it("falls back when priority source has empty value", () => {
      const aggregator = new FieldAggregator({
        studio: [Website.JAVDB, Website.DMM],
      });

      const results = new Map<Website, CrawlerData>([
        [Website.DMM, makeCrawlerData({ studio: "DMM Studio", website: Website.DMM })],
        [Website.JAVDB, makeCrawlerData({ studio: undefined, website: Website.JAVDB })],
      ]);

      const { data, sources } = aggregator.aggregate(results);
      expect(data.studio).toBe("DMM Studio");
      expect(sources.studio).toBe(Website.DMM);
    });
  });

  describe("longest strategy", () => {
    it("selects the longest plot across sources", () => {
      const aggregator = new FieldAggregator({});

      const results = new Map<Website, CrawlerData>([
        [Website.DMM, makeCrawlerData({ plot: "Short plot", website: Website.DMM })],
        [
          Website.JAVDB,
          makeCrawlerData({ plot: "This is a much longer plot description from JAVDB", website: Website.JAVDB }),
        ],
      ]);

      const { data, sources } = aggregator.aggregate(results);
      expect(data.plot).toBe("This is a much longer plot description from JAVDB");
      expect(sources.plot).toBe(Website.JAVDB);
    });
  });

  describe("array selection strategy", () => {
    it("prefers the highest-priority non-empty actor list without merging sites", () => {
      const aggregator = new FieldAggregator({
        actors: [Website.AVBASE, Website.JAVBUS, Website.JAVDB],
      });

      const results = new Map<Website, CrawlerData>([
        [Website.JAVBUS, makeCrawlerData({ actors: ["女优 A", "男优 B"], website: Website.JAVBUS })],
        [Website.AVBASE, makeCrawlerData({ actors: ["女优 A", "女优 C"], website: Website.AVBASE })],
        [Website.JAVDB, makeCrawlerData({ actors: ["女优 A"], website: Website.JAVDB })],
      ]);

      const { data, sources } = aggregator.aggregate(results);
      expect(data.actors).toEqual(["女优 A", "女优 C"]);
      expect(sources.actors).toBe(Website.AVBASE);
    });

    it("falls back to the next site when the highest-priority actor list is empty", () => {
      const aggregator = new FieldAggregator({
        actors: [Website.AVBASE, Website.JAVDB],
      });

      const results = new Map<Website, CrawlerData>([
        [Website.AVBASE, makeCrawlerData({ actors: [], website: Website.AVBASE })],
        [Website.JAVDB, makeCrawlerData({ actors: ["女优 A", "女优 B"], website: Website.JAVDB })],
      ]);

      const { data, sources } = aggregator.aggregate(results);
      expect(data.actors).toEqual(["女优 A", "女优 B"]);
      expect(sources.actors).toBe(Website.JAVDB);
    });

    it("prefers the first non-empty genres without merging sites", () => {
      const aggregator = new FieldAggregator({});

      const results = new Map<Website, CrawlerData>([
        [Website.DMM, makeCrawlerData({ genres: ["Tag A", "Tag B"], website: Website.DMM })],
        [Website.JAVDB, makeCrawlerData({ genres: ["tag a", "Tag C"], website: Website.JAVDB })],
      ]);

      const { data } = aggregator.aggregate(results);
      expect(data.genres).toEqual(["Tag A", "Tag B"]);
    });

    it("keeps scene images as a single source set and preserves fallback sets separately", () => {
      const aggregator = new FieldAggregator({});

      const results = new Map<Website, CrawlerData>([
        [Website.DMM, makeCrawlerData({ sample_images: ["https://a.jpg", "https://b.jpg"], website: Website.DMM })],
        [Website.JAVDB, makeCrawlerData({ sample_images: ["https://b.jpg", "https://c.jpg"], website: Website.JAVDB })],
      ]);

      const { data, imageAlternatives, sources } = aggregator.aggregate(results);
      expect(data.sample_images).toEqual(["https://a.jpg", "https://b.jpg"]);
      expect(imageAlternatives.sample_images).toEqual([["https://b.jpg", "https://c.jpg"]]);
      expect(imageAlternatives.sample_images_source).toBe(Website.DMM);
      expect(imageAlternatives.sample_image_sources).toEqual([Website.JAVDB]);
      expect(sources.sample_images).toBe(Website.DMM);
    });

    it("respects maxActors limit", () => {
      const aggregator = new FieldAggregator({}, { maxActors: 2 });

      const results = new Map<Website, CrawlerData>([
        [Website.DMM, makeCrawlerData({ actors: ["A", "B", "C", "D"], website: Website.DMM })],
      ]);

      const { data } = aggregator.aggregate(results);
      expect(data.actors).toHaveLength(2);
    });
  });

  describe("highest_quality strategy", () => {
    it("prefers AWS DMM URLs for thumb", () => {
      const aggregator = new FieldAggregator({
        thumb_url: [Website.JAVDB, Website.DMM],
      });

      const results = new Map<Website, CrawlerData>([
        [Website.DMM, makeCrawlerData({ thumb_url: "https://awsimgsrc.dmm.co.jp/thumb.jpg", website: Website.DMM })],
        [Website.JAVDB, makeCrawlerData({ thumb_url: "https://javdb.com/thumb.jpg", website: Website.JAVDB })],
      ]);

      const { data, sources } = aggregator.aggregate(results);
      expect(data.thumb_url).toBe("https://awsimgsrc.dmm.co.jp/thumb.jpg");
      expect(sources.thumb_url).toBe(Website.DMM);
    });

    it("falls back to first_non_null when no AWS URL available", () => {
      const aggregator = new FieldAggregator({
        thumb_url: [Website.JAVDB, Website.DMM],
      });

      const results = new Map<Website, CrawlerData>([
        [Website.DMM, makeCrawlerData({ thumb_url: "https://dmm.co.jp/thumb.jpg", website: Website.DMM })],
        [Website.JAVDB, makeCrawlerData({ thumb_url: "https://javdb.com/thumb.jpg", website: Website.JAVDB })],
      ]);

      const { data } = aggregator.aggregate(results);
      // JAVDB has higher priority, so it should win
      expect(data.thumb_url).toBe("https://javdb.com/thumb.jpg");
    });
  });

  it("throws when no results provided", () => {
    const aggregator = new FieldAggregator({});
    expect(() => aggregator.aggregate(new Map())).toThrow("No results to aggregate");
  });
});

// ── AggregationService tests ──

class MultiResultCrawlerProvider extends CrawlerProvider {
  private readonly siteResults: Map<Website, CrawlerData>;
  private readonly siteDelaysMs: Partial<Record<Website, number>>;
  readonly calledSites: Website[] = [];

  constructor(siteResults: Map<Website, CrawlerData>, siteDelaysMs: Partial<Record<Website, number>> = {}) {
    super({ fetchGateway: new FetchGateway(new NetworkClient()) });
    this.siteResults = siteResults;
    this.siteDelaysMs = siteDelaysMs;
  }

  override async crawl(input: CrawlerInput): Promise<CrawlerResponse> {
    this.calledSites.push(input.site);

    const delayMs = this.siteDelaysMs[input.site] ?? 0;
    await waitForDelay(delayMs, input.options?.signal);

    const data = this.siteResults.get(input.site);
    if (!data) {
      return {
        input,
        elapsedMs: 1,
        result: { success: false, error: `No data for ${input.site}` },
      };
    }

    return {
      input,
      elapsedMs: 1,
      result: { success: true, data },
    };
  }
}

describe("AggregationService", () => {
  const makeConfig = (overrides: Record<string, unknown> = {}) =>
    configurationSchema.parse({
      ...defaultConfiguration,
      scrape: {
        ...defaultConfiguration.scrape,
        enabledSites: [Website.DMM, Website.JAVDB, Website.JAVBUS],
        siteOrder: [Website.DMM, Website.JAVDB, Website.JAVBUS],
      },
      ...overrides,
    });

  it("aggregates results from multiple successful crawlers", async () => {
    const siteResults = new Map<Website, CrawlerData>([
      [
        Website.DMM,
        makeCrawlerData({
          title: undefined,
          plot: "Short DMM plot",
          thumb_url: "https://awsimgsrc.dmm.co.jp/thumb.jpg",
          website: Website.DMM,
        }),
      ],
      [
        Website.JAVDB,
        makeCrawlerData({
          title: "JAVDB Title",
          plot: "Longer JAVDB plot description here",
          actors: ["Actor A", "Actor B"],
          genres: ["Tag 1", "Tag 2"],
          website: Website.JAVDB,
        }),
      ],
    ]);

    const provider = new MultiResultCrawlerProvider(siteResults);
    const service = new AggregationService(provider);
    const config = makeConfig();

    const result = await service.aggregate("ABF-075", config);

    expect(result).not.toBeNull();
    expect(result?.data.title).toBeDefined();
    expect(result?.data.number).toBe("ABF-075");
    expect(result?.data.plot).toBe("Longer JAVDB plot description here");
    expect(result?.data.thumb_url).toBe("https://awsimgsrc.dmm.co.jp/thumb.jpg");
    expect(result?.stats.successCount).toBe(2);
    expect(result?.stats.failedCount).toBe(1);
    expect(result?.stats.skippedCount).toBe(0);
  });

  it("uses configured durationSeconds priority instead of completion order", async () => {
    const siteResults = new Map<Website, CrawlerData>([
      [
        Website.AVBASE,
        makeCrawlerData({
          title: undefined,
          durationSeconds: 8_100,
          thumb_url: undefined,
          website: Website.AVBASE,
        }),
      ],
      [
        Website.DMM_TV,
        makeCrawlerData({
          durationSeconds: 7_200,
          thumb_url: "https://dmmtv.example/thumb.jpg",
          website: Website.DMM_TV,
        }),
      ],
    ]);

    const provider = new MultiResultCrawlerProvider(siteResults, {
      [Website.AVBASE]: 0,
      [Website.DMM_TV]: 30,
    });
    const service = new AggregationService(provider);
    const config = configurationSchema.parse({
      ...defaultConfiguration,
      scrape: {
        ...defaultConfiguration.scrape,
        enabledSites: [Website.AVBASE, Website.DMM_TV],
        siteOrder: [Website.AVBASE, Website.DMM_TV],
      },
      aggregation: {
        ...defaultConfiguration.aggregation,
        fieldPriorities: {
          ...defaultConfiguration.aggregation.fieldPriorities,
          durationSeconds: [Website.DMM_TV, Website.AVBASE],
        },
      },
    });

    const result = await service.aggregate("ABF-075", config);

    expect(result).not.toBeNull();
    expect(result?.data.durationSeconds).toBe(7_200);
    expect(result?.sources.durationSeconds).toBe(Website.DMM_TV);
  });

  it("returns null when no crawlers succeed", async () => {
    const provider = new MultiResultCrawlerProvider(new Map());
    const service = new AggregationService(provider);
    const config = makeConfig();

    const result = await service.aggregate("ABF-075", config);
    expect(result).toBeNull();
  });

  it("returns null when minimum threshold not met (missing thumb and poster)", async () => {
    const siteResults = new Map<Website, CrawlerData>([
      [
        Website.DMM,
        makeCrawlerData({
          title: "Has title",
          thumb_url: undefined,
          poster_url: undefined,
          website: Website.DMM,
        }),
      ],
    ]);

    const provider = new MultiResultCrawlerProvider(siteResults);
    const service = new AggregationService(provider);
    const config = makeConfig();

    const result = await service.aggregate("ABF-075", config);
    expect(result).toBeNull();
  });

  it("caches results for repeated calls", async () => {
    const siteResults = new Map<Website, CrawlerData>([
      [
        Website.DMM,
        makeCrawlerData({
          thumb_url: "https://example.com/thumb.jpg",
          website: Website.DMM,
        }),
      ],
    ]);

    const provider = new MultiResultCrawlerProvider(siteResults);
    const service = new AggregationService(provider);
    const config = makeConfig();

    const first = await service.aggregate("ABF-075", config);
    expect(first).not.toBeNull();
    const firstCallCount = provider.calledSites.length;
    expect(firstCallCount).toBeGreaterThan(0);

    const second = await service.aggregate("ABF-075", config);
    expect(second).toBe(first);
    expect(provider.calledSites.length).toBe(firstCallCount);
  });

  it("stops launching lower-priority sites once minimum threshold is satisfied", async () => {
    const siteResults = new Map<Website, CrawlerData>([
      [
        Website.DMM,
        makeCrawlerData({
          title: "Fast DMM Title",
          thumb_url: "https://thumb.jpg",
          website: Website.DMM,
        }),
      ],
      [
        Website.JAVDB,
        makeCrawlerData({
          title: "Slower JAVDB Title",
          thumb_url: "https://javdb-thumb.jpg",
          website: Website.JAVDB,
        }),
      ],
    ]);

    const provider = new MultiResultCrawlerProvider(siteResults);
    const service = new AggregationService(provider);
    const config = makeConfig({
      aggregation: {
        ...defaultConfiguration.aggregation,
        maxParallelCrawlers: 1,
      },
      download: {
        ...defaultConfiguration.download,
        downloadSceneImages: false,
        downloadNfo: false,
      },
    });

    await service.aggregate("ABF-075", config);

    expect(provider.calledSites).toEqual([Website.DMM]);
  });

  it("clears cache when clearCache is called", async () => {
    const siteResults = new Map<Website, CrawlerData>([
      [Website.DMM, makeCrawlerData({ thumb_url: "https://thumb.jpg", website: Website.DMM })],
    ]);

    const provider = new MultiResultCrawlerProvider(siteResults);
    const service = new AggregationService(provider);
    const config = makeConfig();

    await service.aggregate("ABF-075", config);
    const firstCallCount = provider.calledSites.length;
    expect(firstCallCount).toBeGreaterThan(0);

    service.clearCache();
    await service.aggregate("ABF-075", config);
    expect(provider.calledSites.length).toBe(firstCallCount * 2);
  });

  it("limits FC2 numbers to fc2 and javdb sites only", async () => {
    const siteResults = new Map<Website, CrawlerData>([
      [
        Website.FC2,
        makeCrawlerData({
          title: "FC2 Title",
          number: "FC2-4775286",
          thumb_url: "https://fc2.example/thumb.jpg",
          website: Website.FC2,
        }),
      ],
      [
        Website.JAVDB,
        makeCrawlerData({
          title: "JAVDB FC2 Title",
          number: "FC2-4775286",
          website: Website.JAVDB,
        }),
      ],
    ]);

    const provider = new MultiResultCrawlerProvider(siteResults);
    const service = new AggregationService(provider);
    const config = makeConfig({
      scrape: {
        ...defaultConfiguration.scrape,
        enabledSites: [Website.DMM, Website.MGSTAGE, Website.FC2, Website.JAVDB, Website.JAVBUS],
        siteOrder: [Website.DMM, Website.MGSTAGE, Website.FC2, Website.JAVDB, Website.JAVBUS],
      },
    });

    const result = await service.aggregate("FC2-4775286", config);

    expect(result).not.toBeNull();
    expect(provider.calledSites.sort()).toEqual([Website.FC2, Website.JAVDB].sort());
  });

  it("aborts a slow crawler once its wall-clock budget is exhausted", async () => {
    const siteResults = new Map<Website, CrawlerData>([
      [
        Website.DMM,
        makeCrawlerData({
          title: "Slow DMM Title",
          thumb_url: "https://slow-thumb.jpg",
          website: Website.DMM,
        }),
      ],
    ]);

    const provider = new MultiResultCrawlerProvider(siteResults, {
      [Website.DMM]: 80,
    });
    const service = new AggregationService(provider);
    const config = makeConfig({
      scrape: {
        ...defaultConfiguration.scrape,
        enabledSites: [Website.DMM],
        siteOrder: [Website.DMM],
      },
    });
    config.aggregation.maxParallelCrawlers = 1;
    config.aggregation.perCrawlerTimeoutMs = 20;
    config.aggregation.globalTimeoutMs = 100;

    const result = await service.aggregate("ABF-075", config);

    expect(result).toBeNull();
    expect(provider.calledSites).toEqual([Website.DMM]);
  });
});
