import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { CrawlerProvider, FetchGateway } from "@main/services/crawler";
import type { CrawlerInput, CrawlerResponse, FailureReason } from "@main/services/crawler/base/types";
import { NetworkClient } from "@main/services/network";
import { AggregationService } from "@main/services/scraper/aggregation/AggregationService";
import { FieldAggregator } from "@main/services/scraper/aggregation/FieldAggregator";
import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
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
    ];

    for (const { aggregator, results, field, expectedValue, expectedSource } of cases) {
      const { data, sources } = aggregator.aggregate(results);

      expect(data[field as keyof CrawlerData]).toBe(expectedValue);
      expect(sources[field as keyof CrawlerData]).toBe(expectedSource);
    }
  });

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

  it("selects array fields without merging across sites", () => {
    const cases = [
      {
        aggregator: new FieldAggregator({
          actors: [Website.AVBASE, Website.JAVBUS, Website.JAVDB],
        }),
        results: new Map<Website, CrawlerData>([
          [Website.JAVBUS, makeCrawlerData({ actors: ["女优 A", "男优 B"], website: Website.JAVBUS })],
          [Website.AVBASE, makeCrawlerData({ actors: ["女优 A", "女优 C"], website: Website.AVBASE })],
          [Website.JAVDB, makeCrawlerData({ actors: ["女优 A"], website: Website.JAVDB })],
        ]),
        field: "actors",
        expectedValue: ["女优 A", "女优 C"],
        expectedSource: Website.AVBASE,
      },
      {
        aggregator: new FieldAggregator({
          actors: [Website.AVBASE, Website.JAVDB],
        }),
        results: new Map<Website, CrawlerData>([
          [Website.AVBASE, makeCrawlerData({ actors: [], website: Website.AVBASE })],
          [Website.JAVDB, makeCrawlerData({ actors: ["女优 A", "女优 B"], website: Website.JAVDB })],
        ]),
        field: "actors",
        expectedValue: ["女优 A", "女优 B"],
        expectedSource: Website.JAVDB,
      },
      {
        aggregator: new FieldAggregator({}),
        results: new Map<Website, CrawlerData>([
          [Website.DMM, makeCrawlerData({ genres: ["Tag A", "Tag B"], website: Website.DMM })],
          [Website.JAVDB, makeCrawlerData({ genres: ["tag a", "Tag C"], website: Website.JAVDB })],
        ]),
        field: "genres",
        expectedValue: ["Tag A", "Tag B"],
        expectedSource: undefined,
      },
    ];

    for (const { aggregator, results, field, expectedValue, expectedSource } of cases) {
      const { data, sources } = aggregator.aggregate(results);

      expect(data[field as keyof CrawlerData]).toEqual(expectedValue);
      if (expectedSource !== undefined) {
        expect(sources[field as keyof CrawlerData]).toBe(expectedSource);
      }
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

class MultiResultCrawlerProvider extends CrawlerProvider {
  private readonly siteResults: Map<Website, CrawlerData>;
  private readonly siteDelaysMs: Partial<Record<Website, number>>;
  private readonly siteFailures: Map<Website, { error: string; failureReason?: FailureReason }>;
  readonly calledSites: Website[] = [];

  constructor(
    siteResults: Map<Website, CrawlerData>,
    siteDelaysMs: Partial<Record<Website, number>> = {},
    siteFailures: Map<Website, { error: string; failureReason?: FailureReason }> = new Map(),
  ) {
    super({ fetchGateway: new FetchGateway(new NetworkClient()) });
    this.siteResults = siteResults;
    this.siteDelaysMs = siteDelaysMs;
    this.siteFailures = siteFailures;
  }

  override async crawl(input: CrawlerInput): Promise<CrawlerResponse> {
    this.calledSites.push(input.site);

    const delayMs = this.siteDelaysMs[input.site] ?? 0;
    await waitForDelay(delayMs, input.options?.signal);

    const failure = this.siteFailures.get(input.site);
    if (failure) {
      return {
        input,
        elapsedMs: 1,
        result: { success: false, error: failure.error, failureReason: failure.failureReason },
      };
    }

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

class RecordingCrawlerProvider extends MultiResultCrawlerProvider {
  readonly calledNumbers: string[] = [];

  override async crawl(input: CrawlerInput): Promise<CrawlerResponse> {
    this.calledNumbers.push(input.number);
    return super.crawl(input);
  }
}

describe("AggregationService", () => {
  const makeConfig = (overrides: Record<string, unknown> = {}) =>
    configurationSchema.parse({
      ...defaultConfiguration,
      scrape: {
        ...defaultConfiguration.scrape,
        sites: [Website.DMM, Website.JAVDB, Website.JAVBUS],
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

    const result = await new AggregationService(new MultiResultCrawlerProvider(siteResults)).aggregate(
      "ABF-075",
      makeConfig(),
    );

    expect(result).not.toBeNull();
    expect(result?.data.title).toBeDefined();
    expect(result?.data.number).toBe("ABF-075");
    expect(result?.data.plot).toBe("Longer JAVDB plot description here");
    expect(result?.data.thumb_url).toBe("https://awsimgsrc.dmm.co.jp/thumb.jpg");
    expect(result?.stats.successCount).toBe(2);
    expect(result?.stats.failedCount).toBe(1);
    expect(result?.stats.skippedCount).toBe(0);
  });

  it("records DMM blocked failures and uses avwikidb only when it is enabled", async () => {
    const siteResults = new Map<Website, CrawlerData>([
      [
        Website.AVWIKIDB,
        makeCrawlerData({
          title: "AVWikiDB Title",
          actors: ["Actor From AVWikiDB"],
          thumb_url: "https://avwikidb.example/thumb.jpg",
          website: Website.AVWIKIDB,
        }),
      ],
    ]);
    const siteFailures = new Map<Website, { error: string; failureReason?: FailureReason }>([
      [Website.DMM, { error: "DMM region blocked", failureReason: "region_blocked" }],
    ]);
    const provider = new MultiResultCrawlerProvider(siteResults, {}, siteFailures);
    const config = makeConfig({
      scrape: {
        ...defaultConfiguration.scrape,
        sites: [Website.DMM, Website.AVWIKIDB],
      },
    });

    const result = await new AggregationService(provider).aggregate("ABF-075", config);

    expect(provider.calledSites).toEqual([Website.DMM, Website.AVWIKIDB]);
    expect(result).not.toBeNull();
    expect(result?.data.title).toBe("AVWikiDB Title");
    expect(result?.sources.title).toBe(Website.AVWIKIDB);
    expect(result?.stats.siteResults.find((siteResult) => siteResult.site === Website.DMM)?.failureReason).toBe(
      "region_blocked",
    );
  });

  it("marks crawler budget overruns as timeout failures", async () => {
    const siteResults = new Map<Website, CrawlerData>([
      [
        Website.DMM,
        makeCrawlerData({
          title: "Slow DMM Title",
          thumb_url: "https://dmm.example/thumb.jpg",
          website: Website.DMM,
        }),
      ],
      [
        Website.JAVDB,
        makeCrawlerData({
          title: "Fast JAVDB Title",
          thumb_url: "https://javdb.example/thumb.jpg",
          website: Website.JAVDB,
        }),
      ],
    ]);
    const provider = new MultiResultCrawlerProvider(siteResults, { [Website.DMM]: 30 });
    const config = makeConfig({
      scrape: {
        ...defaultConfiguration.scrape,
        sites: [Website.DMM, Website.JAVDB],
      },
    });
    config.aggregation.maxParallelCrawlers = 2;
    config.aggregation.perCrawlerTimeoutMs = 5;
    config.aggregation.globalTimeoutMs = 1_000;

    const result = await new AggregationService(provider).aggregate("ABF-075", config);

    const dmmResult = result?.stats.siteResults.find((siteResult) => siteResult.site === Website.DMM);
    expect(dmmResult?.success).toBe(false);
    expect(dmmResult?.error).toContain("exceeded crawler budget");
    expect(dmmResult?.failureReason).toBe("timeout");
  });

  it("does not query avwikidb when it is not enabled", async () => {
    const siteResults = new Map<Website, CrawlerData>([
      [
        Website.AVBASE,
        makeCrawlerData({
          title: "AVBase Title",
          actors: ["Actor A"],
          thumb_url: "https://avbase.example/thumb.jpg",
          website: Website.AVBASE,
        }),
      ],
    ]);
    const provider = new MultiResultCrawlerProvider(siteResults);
    const config = makeConfig({
      scrape: {
        ...defaultConfiguration.scrape,
        sites: [Website.AVBASE],
      },
      download: {
        ...defaultConfiguration.download,
        downloadSceneImages: false,
      },
    });

    const result = await new AggregationService(provider).aggregate("ABF-075", config);

    expect(provider.calledSites).toEqual([Website.AVBASE]);
    expect(result).not.toBeNull();
    expect(result?.data.title).toBe("AVBase Title");
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
    const config = configurationSchema.parse({
      ...defaultConfiguration,
      scrape: {
        ...defaultConfiguration.scrape,
        sites: [Website.AVBASE, Website.DMM_TV],
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

    const result = await new AggregationService(provider).aggregate("ABF-075", config);

    expect(result).not.toBeNull();
    expect(result?.data.durationSeconds).toBe(7_200);
    expect(result?.sources.durationSeconds).toBe(Website.DMM_TV);
  });

  it("prefers FC2HUB ahead of JAVDB for FC2 family metadata under the default priorities", async () => {
    const siteResults = new Map<Website, CrawlerData>([
      [
        Website.FC2HUB,
        makeCrawlerData({
          title: "FC2HUB Title",
          number: "FC2-4515706",
          thumb_url: "https://fc2hub.example/thumb.jpg",
          studio: "Seller FC2HUB",
          publisher: "Seller FC2HUB",
          durationSeconds: 8_068,
          rating: 4.7,
          website: Website.FC2HUB,
        }),
      ],
      [
        Website.JAVDB,
        makeCrawlerData({
          title: "JAVDB Title",
          number: "FC2-4515706",
          thumb_url: "https://javdb.example/thumb.jpg",
          studio: "Seller JAVDB",
          publisher: "Publisher JAVDB",
          durationSeconds: 7_200,
          rating: 4.1,
          website: Website.JAVDB,
        }),
      ],
    ]);

    const config = configurationSchema.parse({
      ...defaultConfiguration,
      scrape: {
        ...defaultConfiguration.scrape,
        sites: [Website.FC2HUB, Website.JAVDB],
        siteOrder: [Website.FC2HUB, Website.JAVDB],
      },
    });

    const result = await new AggregationService(new MultiResultCrawlerProvider(siteResults)).aggregate(
      "FC2-4515706",
      config,
    );

    expect(result).not.toBeNull();
    expect(result?.data.title).toBe("FC2HUB Title");
    expect(result?.data.studio).toBe("Seller FC2HUB");
    expect(result?.data.publisher).toBe("Seller FC2HUB");
    expect(result?.data.durationSeconds).toBe(8_068);
    expect(result?.data.rating).toBe(4.7);
    expect(result?.sources.title).toBe(Website.FC2HUB);
    expect(result?.sources.studio).toBe(Website.FC2HUB);
    expect(result?.sources.publisher).toBe(Website.FC2HUB);
    expect(result?.sources.durationSeconds).toBe(Website.FC2HUB);
    expect(result?.sources.rating).toBe(Website.FC2HUB);
  });

  it("keeps DMM family identity fields aligned with the title-winning source", async () => {
    const siteResults = new Map<Website, CrawlerData>([
      [
        Website.DMM,
        makeCrawlerData({
          title: "DMM Title",
          genres: ["DMM Genre"],
          studio: "DMM Studio",
          durationSeconds: 7_200,
          rating: 4.6,
          trailer_url: "https://dmm.example.com/trailer.mp4",
          thumb_url: "https://awsimgsrc.dmm.co.jp/dmm.jpg",
          website: Website.DMM,
        }),
      ],
      [
        Website.DMM_TV,
        makeCrawlerData({
          title: "DMM TV Title",
          genres: ["DMM TV Genre 1", "DMM TV Genre 2"],
          studio: "DMM TV Studio",
          durationSeconds: 5_400,
          rating: 3.2,
          trailer_url: "https://video.example.com/trailer.mp4",
          thumb_url: "https://video.example.com/thumb.jpg",
          website: Website.DMM_TV,
        }),
      ],
    ]);

    const config = makeConfig({
      scrape: {
        ...defaultConfiguration.scrape,
        enabledSites: [Website.DMM, Website.DMM_TV],
        siteOrder: [Website.DMM, Website.DMM_TV],
      },
      aggregation: {
        ...defaultConfiguration.aggregation,
        fieldPriorities: {
          ...defaultConfiguration.aggregation.fieldPriorities,
          title: [Website.DMM_TV, Website.DMM],
          genres: [Website.DMM, Website.DMM_TV],
          studio: [Website.DMM, Website.DMM_TV],
          durationSeconds: [Website.DMM, Website.DMM_TV],
          rating: [Website.DMM, Website.DMM_TV],
          trailer_url: [Website.DMM, Website.DMM_TV],
        },
      },
    });

    const result = await new AggregationService(new MultiResultCrawlerProvider(siteResults)).aggregate(
      "ABF-075",
      config,
    );

    expect(result?.data.title).toBe("DMM TV Title");
    expect(result?.data.genres).toEqual(["DMM TV Genre 1", "DMM TV Genre 2"]);
    expect(result?.data.studio).toBe("DMM TV Studio");
    expect(result?.data.durationSeconds).toBe(7_200);
    expect(result?.data.rating).toBe(4.6);
    expect(result?.data.trailer_url).toBe("https://dmm.example.com/trailer.mp4");
    expect(result?.sources.title).toBe(Website.DMM_TV);
    expect(result?.sources.genres).toBe(Website.DMM_TV);
    expect(result?.sources.studio).toBe(Website.DMM_TV);
    expect(result?.sources.durationSeconds).toBe(Website.DMM);
    expect(result?.sources.rating).toBe(Website.DMM);
    expect(result?.sources.trailer_url).toBe(Website.DMM);
  });

  it("uses PPVDATABANK as an FC2 fallback when higher-priority sources miss seller and image fields", async () => {
    const siteResults = new Map<Website, CrawlerData>([
      [
        Website.FC2HUB,
        makeCrawlerData({
          title: "FC2HUB Title",
          number: "FC2-4663355",
          thumb_url: undefined,
          poster_url: undefined,
          studio: undefined,
          publisher: undefined,
          release_date: undefined,
          durationSeconds: undefined,
          website: Website.FC2HUB,
        }),
      ],
      [
        Website.PPVDATABANK,
        makeCrawlerData({
          title: "PPVDATABANK Title",
          number: "FC2-4663355",
          thumb_url: "https://ppvdatabank.example/thumb.webp",
          poster_url: "https://ppvdatabank.example/thumb.webp",
          scene_images: ["https://ppvdatabank.example/pl1.webp"],
          studio: "ゆず故障",
          publisher: "ゆず故障",
          release_date: "2025-04-03",
          durationSeconds: 3_080,
          website: Website.PPVDATABANK,
        }),
      ],
    ]);

    const config = configurationSchema.parse({
      ...defaultConfiguration,
      scrape: {
        ...defaultConfiguration.scrape,
        sites: [Website.FC2HUB, Website.PPVDATABANK],
        siteOrder: [Website.FC2HUB, Website.PPVDATABANK],
      },
    });

    const result = await new AggregationService(new MultiResultCrawlerProvider(siteResults)).aggregate(
      "FC2-4663355",
      config,
    );

    expect(result).not.toBeNull();
    expect(result?.data.title).toBe("FC2HUB Title");
    expect(result?.data.studio).toBe("ゆず故障");
    expect(result?.data.publisher).toBe("ゆず故障");
    expect(result?.data.release_date).toBe("2025-04-03");
    expect(result?.data.durationSeconds).toBe(3_080);
    expect(result?.data.thumb_url).toBe("https://ppvdatabank.example/thumb.webp");
    expect(result?.data.poster_url).toBe("https://ppvdatabank.example/thumb.webp");
    expect(result?.data.scene_images).toEqual(["https://ppvdatabank.example/pl1.webp"]);
    expect(result?.sources.title).toBe(Website.FC2HUB);
    expect(result?.sources.studio).toBe(Website.PPVDATABANK);
    expect(result?.sources.publisher).toBe(Website.PPVDATABANK);
    expect(result?.sources.release_date).toBe(Website.PPVDATABANK);
    expect(result?.sources.durationSeconds).toBe(Website.PPVDATABANK);
    expect(result?.sources.thumb_url).toBe(Website.PPVDATABANK);
    expect(result?.sources.poster_url).toBe(Website.PPVDATABANK);
    expect(result?.sources.scene_images).toBe(Website.PPVDATABANK);
  });

  it("returns null when no result clears the aggregation threshold", async () => {
    const cases = [
      {
        provider: new MultiResultCrawlerProvider(new Map<Website, CrawlerData>()),
        config: makeConfig(),
      },
      {
        provider: new MultiResultCrawlerProvider(
          new Map<Website, CrawlerData>([
            [
              Website.DMM,
              makeCrawlerData({
                title: "Has title",
                thumb_url: undefined,
                poster_url: undefined,
                website: Website.DMM,
              }),
            ],
          ]),
        ),
        config: makeConfig(),
      },
    ];

    for (const { provider, config } of cases) {
      await expect(new AggregationService(provider).aggregate("ABF-075", config)).resolves.toBeNull();
    }
  });

  it("caches results until clearCache is called", async () => {
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
    const firstCallCount = provider.calledSites.length;
    const second = await service.aggregate("ABF-075", config);

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(provider.calledSites.length).toBe(firstCallCount);

    service.clearCache();
    await service.aggregate("ABF-075", config);
    expect(provider.calledSites.length).toBe(firstCallCount * 2);
  });

  it("caps the cache and keeps recently used entries", async () => {
    const siteResults = new Map<Website, CrawlerData>([
      [
        Website.DMM,
        makeCrawlerData({
          number: undefined,
          thumb_url: "https://example.com/thumb.jpg",
          website: Website.DMM,
        }),
      ],
    ]);

    const provider = new RecordingCrawlerProvider(siteResults);
    const service = new AggregationService(provider);
    const config = makeConfig({
      scrape: {
        ...defaultConfiguration.scrape,
        sites: [Website.DMM],
        siteOrder: [Website.DMM],
      },
    });

    for (let index = 1; index <= 200; index++) {
      await service.aggregate(`ABF-${index.toString().padStart(3, "0")}`, config);
    }

    await service.aggregate("ABF-001", config);
    await service.aggregate("ABF-201", config);
    await service.aggregate("ABF-002", config);
    await service.aggregate("ABF-001", config);

    const callCountByNumber = provider.calledNumbers.reduce<Record<string, number>>((counts, number) => {
      counts[number] = (counts[number] ?? 0) + 1;
      return counts;
    }, {});

    expect(callCountByNumber["ABF-001"]).toBe(1);
    expect(callCountByNumber["ABF-002"]).toBe(2);
    expect(callCountByNumber["ABF-201"]).toBe(1);
    expect((service as unknown as { cache: Map<string, unknown> }).cache.size).toBe(200);
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

    const config = makeConfig({
      aggregation: {
        ...defaultConfiguration.aggregation,
        maxParallelCrawlers: 1,
      },
      download: {
        ...defaultConfiguration.download,
        downloadSceneImages: false,
        generateNfo: false,
      },
    });

    const provider = new MultiResultCrawlerProvider(siteResults);
    await new AggregationService(provider).aggregate("ABF-075", config);

    expect(provider.calledSites).toEqual([Website.DMM]);
  });

  it("limits FC2 numbers to the FC2 crawler family only", async () => {
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
        Website.FC2HUB,
        makeCrawlerData({
          title: "FC2HUB Title",
          number: "FC2-4775286",
          website: Website.FC2HUB,
        }),
      ],
      [
        Website.PPVDATABANK,
        makeCrawlerData({
          title: "PPVDATABANK FC2 Title",
          number: "FC2-4775286",
          website: Website.PPVDATABANK,
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
    const result = await new AggregationService(provider).aggregate(
      "FC2-4775286",
      makeConfig({
        scrape: {
          ...defaultConfiguration.scrape,
          sites: [
            Website.DMM,
            Website.MGSTAGE,
            Website.FC2,
            Website.FC2HUB,
            Website.PPVDATABANK,
            Website.JAVDB,
            Website.JAVBUS,
          ],
          siteOrder: [
            Website.DMM,
            Website.MGSTAGE,
            Website.FC2,
            Website.FC2HUB,
            Website.PPVDATABANK,
            Website.JAVDB,
            Website.JAVBUS,
          ],
        },
      }),
    );

    expect(result).not.toBeNull();
    expect(provider.calledSites.sort()).toEqual(
      [Website.FC2, Website.FC2HUB, Website.PPVDATABANK, Website.JAVDB].sort(),
    );
  });

  it("skips FC2-only sites when aggregating a non-FC2 number", async () => {
    const siteResults = new Map<Website, CrawlerData>([
      [
        Website.DMM,
        makeCrawlerData({
          title: "DMM Title",
          thumb_url: "https://dmm.example/thumb.jpg",
          website: Website.DMM,
        }),
      ],
      [
        Website.JAVDB,
        makeCrawlerData({
          title: "JAVDB Title",
          thumb_url: "https://javdb.example/thumb.jpg",
          website: Website.JAVDB,
        }),
      ],
      [
        Website.FC2,
        makeCrawlerData({
          title: "FC2 Title",
          thumb_url: "https://fc2.example/thumb.jpg",
          website: Website.FC2,
        }),
      ],
      [
        Website.FC2HUB,
        makeCrawlerData({
          title: "FC2HUB Title",
          thumb_url: "https://fc2hub.example/thumb.jpg",
          website: Website.FC2HUB,
        }),
      ],
      [
        Website.PPVDATABANK,
        makeCrawlerData({
          title: "PPVDATABANK Title",
          thumb_url: "https://ppvdatabank.example/thumb.webp",
          website: Website.PPVDATABANK,
        }),
      ],
    ]);

    const provider = new MultiResultCrawlerProvider(siteResults);
    const result = await new AggregationService(provider).aggregate(
      "ABF-075",
      makeConfig({
        scrape: {
          ...defaultConfiguration.scrape,
          sites: [Website.DMM, Website.FC2, Website.FC2HUB, Website.PPVDATABANK, Website.JAVDB],
          siteOrder: [Website.DMM, Website.FC2, Website.FC2HUB, Website.PPVDATABANK, Website.JAVDB],
        },
      }),
    );

    expect(result).not.toBeNull();
    expect(provider.calledSites.sort()).toEqual([Website.DMM, Website.JAVDB].sort());
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
    const config = makeConfig({
      scrape: {
        ...defaultConfiguration.scrape,
        sites: [Website.DMM],
        siteOrder: [Website.DMM],
      },
    });
    config.aggregation.maxParallelCrawlers = 1;
    config.aggregation.perCrawlerTimeoutMs = 20;
    config.aggregation.globalTimeoutMs = 100;

    const result = await new AggregationService(provider).aggregate("ABF-075", config);

    expect(result).toBeNull();
    expect(provider.calledSites).toEqual([Website.DMM]);
  });
});
