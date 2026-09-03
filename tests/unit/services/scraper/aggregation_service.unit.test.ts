import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import type { CrawlerInput, CrawlerResponse, FailureReason } from "@mdcz/runtime/crawler/base/types";
import { getCrawlerSourceContext, NetworkClient, runWithScrapeItemContext } from "@mdcz/runtime/network";
import { AggregationService } from "@mdcz/runtime/scrape";
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

const makeSiteResults = (...entries: ReadonlyArray<readonly [Website, Partial<CrawlerData>]>) =>
  new Map(entries.map(([website, overrides]) => [website, makeCrawlerData({ website, ...overrides })]));

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
  readonly calledInputs: CrawlerInput[] = [];

  override async crawl(input: CrawlerInput): Promise<CrawlerResponse> {
    this.calledNumbers.push(input.number);
    this.calledInputs.push(input);
    return super.crawl(input);
  }
}

describe("AggregationService", () => {
  type AggregationOverrides = Omit<Partial<typeof defaultConfiguration.aggregation>, "behavior" | "fieldPriorities"> & {
    behavior?: Partial<typeof defaultConfiguration.aggregation.behavior>;
    fieldPriorities?: Partial<typeof defaultConfiguration.aggregation.fieldPriorities>;
  };

  const makeConfig = (
    overrides: {
      scrape?: Partial<typeof defaultConfiguration.scrape>;
      aggregation?: AggregationOverrides;
      download?: Partial<typeof defaultConfiguration.download>;
    } & Record<string, unknown> = {},
  ) => {
    const { scrape, aggregation, download, ...rest } = overrides;
    return configurationSchema.parse({
      ...defaultConfiguration,
      scrape: {
        ...defaultConfiguration.scrape,
        sites: [Website.DMM, Website.JAVDB, Website.JAVBUS],
        ...scrape,
      },
      aggregation: {
        ...defaultConfiguration.aggregation,
        ...aggregation,
        behavior: { ...defaultConfiguration.aggregation.behavior, ...aggregation?.behavior },
        fieldPriorities: {
          ...defaultConfiguration.aggregation.fieldPriorities,
          ...aggregation?.fieldPriorities,
        },
      },
      download: { ...defaultConfiguration.download, ...download },
      ...rest,
    });
  };

  it("aggregates results from multiple successful crawlers", async () => {
    const siteResults = makeSiteResults(
      [Website.DMM, { title: undefined, plot: "Short DMM plot", thumb_url: "https://awsimgsrc.dmm.co.jp/thumb.jpg" }],
      [
        Website.JAVDB,
        {
          title: "JAVDB Title",
          plot: "Longer JAVDB plot description here",
          actors: ["Actor A", "Actor B"],
          genres: ["Tag 1", "Tag 2"],
        },
      ],
    );

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

  it("isolates each concurrent crawler in its Website source context", async () => {
    const provider = new MultiResultCrawlerProvider(
      makeSiteResults(
        [Website.DMM, { thumb_url: "https://dmm.example/thumb.jpg" }],
        [Website.JAVDB, { thumb_url: "https://javdb.example/thumb.jpg" }],
      ),
    );
    const observed: Website[] = [];
    const lateObserved: Array<ReturnType<typeof getCrawlerSourceContext>> = [];
    let releaseLateReads!: () => void;
    const lateGate = new Promise<void>((resolve) => {
      releaseLateReads = resolve;
    });
    const lateReads: Promise<void>[] = [];
    const originalCrawl = provider.crawl.bind(provider);
    provider.crawl = async (input) => {
      await Promise.resolve();
      const source = getCrawlerSourceContext();
      if (source) observed.push(source.website);
      lateReads.push(
        lateGate.then(() => {
          lateObserved.push(getCrawlerSourceContext());
        }),
      );
      return await originalCrawl(input);
    };
    const config = makeConfig({ scrape: { sites: [Website.DMM, Website.JAVDB] } });

    await runWithScrapeItemContext(
      { itemId: "item", relativePath: "movie.mp4", caseId: "movie-case" },
      async () => await new AggregationService(provider).aggregate("ABF-075", config),
    );
    releaseLateReads();
    await Promise.all(lateReads);

    expect(observed).toEqual(expect.arrayContaining([Website.DMM, Website.JAVDB]));
    expect(lateObserved).toEqual([undefined, undefined]);
    expect(getCrawlerSourceContext()).toBeUndefined();
  });

  it("records DMM blocked failures and uses avwikidb only when it is enabled", async () => {
    const siteResults = makeSiteResults([
      Website.AVWIKIDB,
      {
        title: "AVWikiDB Title",
        actors: ["Actor From AVWikiDB"],
        thumb_url: "https://avwikidb.example/thumb.jpg",
      },
    ]);
    const siteFailures = new Map<Website, { error: string; failureReason?: FailureReason }>([
      [Website.DMM, { error: "DMM region blocked", failureReason: "region_blocked" }],
    ]);
    const provider = new MultiResultCrawlerProvider(siteResults, {}, siteFailures);
    const config = makeConfig({
      scrape: { sites: [Website.DMM, Website.AVWIKIDB] },
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
    const siteResults = makeSiteResults(
      [Website.DMM, { title: "Slow DMM Title", thumb_url: "https://dmm.example/thumb.jpg" }],
      [Website.JAVDB, { title: "Fast JAVDB Title", thumb_url: "https://javdb.example/thumb.jpg" }],
    );
    const provider = new MultiResultCrawlerProvider(siteResults, { [Website.DMM]: 30 });
    const config = makeConfig({
      scrape: { sites: [Website.DMM, Website.JAVDB] },
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
    const siteResults = makeSiteResults([
      Website.AVBASE,
      { title: "AVBase Title", actors: ["Actor A"], thumb_url: "https://avbase.example/thumb.jpg" },
    ]);
    const provider = new MultiResultCrawlerProvider(siteResults);
    const config = makeConfig({
      scrape: { sites: [Website.AVBASE] },
      download: { downloadSceneImages: false },
    });

    const result = await new AggregationService(provider).aggregate("ABF-075", config);

    expect(provider.calledSites).toEqual([Website.AVBASE]);
    expect(result).not.toBeNull();
    expect(result?.data.title).toBe("AVBase Title");
    expect(result?.stats.skippedCount).toBe(0);
  });

  it("uses configured durationSeconds priority instead of completion order", async () => {
    const siteResults = makeSiteResults(
      [Website.AVBASE, { title: undefined, durationSeconds: 8_100, thumb_url: undefined }],
      [Website.DMM_TV, { durationSeconds: 7_200, thumb_url: "https://dmmtv.example/thumb.jpg" }],
    );

    const provider = new MultiResultCrawlerProvider(siteResults, {
      [Website.AVBASE]: 0,
      [Website.DMM_TV]: 30,
    });
    const config = makeConfig({
      scrape: {
        sites: [Website.AVBASE, Website.DMM_TV],
      },
      aggregation: {
        fieldPriorities: {
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
    const siteResults = makeSiteResults(
      [
        Website.FC2HUB,
        {
          title: "FC2HUB Title",
          number: "FC2-4515706",
          thumb_url: "https://fc2hub.example/thumb.jpg",
          studio: "Seller FC2HUB",
          publisher: "Seller FC2HUB",
          durationSeconds: 8_068,
          rating: 4.7,
        },
      ],
      [
        Website.JAVDB,
        {
          title: "JAVDB Title",
          number: "FC2-4515706",
          thumb_url: "https://javdb.example/thumb.jpg",
          studio: "Seller JAVDB",
          publisher: "Publisher JAVDB",
          durationSeconds: 7_200,
          rating: 4.1,
        },
      ],
    );

    const config = makeConfig({
      scrape: {
        sites: [Website.FC2HUB, Website.JAVDB],
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

  it("keeps official FC2 seller metadata ahead of FC2HUB seller fallback", async () => {
    const siteResults = makeSiteResults(
      [
        Website.FC2,
        {
          title: "Official FC2 Title",
          number: "FC2-2896877",
          actors: [],
          thumb_url: "https://fc2.example/thumb.jpg",
          studio: "趣味はめ",
          publisher: "趣味はめ",
        },
      ],
      [
        Website.FC2HUB,
        {
          title: "FC2HUB Title",
          number: "FC2-2896877",
          actors: [],
          thumb_url: "https://fc2hub.example/thumb.jpg",
          studio: "アビス",
          publisher: "アビス",
        },
      ],
    );

    const config = makeConfig({
      scrape: {
        sites: [Website.FC2, Website.FC2HUB],
      },
    });

    const result = await new AggregationService(new MultiResultCrawlerProvider(siteResults)).aggregate(
      "FC2-2896877",
      config,
    );

    expect(result).not.toBeNull();
    expect(result?.data.title).toBe("FC2HUB Title");
    expect(result?.data.studio).toBe("趣味はめ");
    expect(result?.data.publisher).toBe("趣味はめ");
    expect(result?.sources.title).toBe(Website.FC2HUB);
    expect(result?.sources.studio).toBe(Website.FC2);
    expect(result?.sources.publisher).toBe(Website.FC2);
  });

  it("applies field priorities independently across DMM sources", async () => {
    const siteResults = makeSiteResults(
      [
        Website.DMM,
        {
          title: "DMM Title",
          genres: ["DMM Genre"],
          studio: "DMM Studio",
          durationSeconds: 7_200,
          rating: 4.6,
          trailer_url: "https://dmm.example.com/trailer.mp4",
          thumb_url: "https://awsimgsrc.dmm.co.jp/dmm.jpg",
        },
      ],
      [
        Website.DMM_TV,
        {
          title: "DMM TV Title",
          genres: ["DMM TV Genre 1", "DMM TV Genre 2"],
          studio: "DMM TV Studio",
          durationSeconds: 5_400,
          rating: 3.2,
          trailer_url: "https://video.example.com/trailer.mp4",
          thumb_url: "https://video.example.com/thumb.jpg",
        },
      ],
    );

    const config = makeConfig({
      scrape: { sites: [Website.DMM, Website.DMM_TV] },
      aggregation: {
        fieldPriorities: {
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
    expect(result?.data.genres).toEqual(["DMM Genre"]);
    expect(result?.data.studio).toBe("DMM Studio");
    expect(result?.data.durationSeconds).toBe(7_200);
    expect(result?.data.rating).toBe(4.6);
    expect(result?.data.trailer_url).toBe("https://dmm.example.com/trailer.mp4");
    expect(result?.sources.title).toBe(Website.DMM_TV);
    expect(result?.sources.genres).toBe(Website.DMM);
    expect(result?.sources.studio).toBe(Website.DMM);
    expect(result?.sources.durationSeconds).toBe(Website.DMM);
    expect(result?.sources.rating).toBe(Website.DMM);
    expect(result?.sources.trailer_url).toBe(Website.DMM);
  });

  it("uses PPVDATABANK as an FC2 fallback when higher-priority sources miss seller and image fields", async () => {
    const siteResults = makeSiteResults(
      [
        Website.FC2HUB,
        {
          title: "FC2HUB Title",
          number: "FC2-4663355",
          thumb_url: undefined,
          poster_url: undefined,
          studio: undefined,
          publisher: undefined,
          release_date: undefined,
          durationSeconds: undefined,
        },
      ],
      [
        Website.PPVDATABANK,
        {
          title: "PPVDATABANK Title",
          number: "FC2-4663355",
          thumb_url: "https://ppvdatabank.example/thumb.webp",
          poster_url: "https://ppvdatabank.example/thumb.webp",
          scene_images: ["https://ppvdatabank.example/pl1.webp"],
          studio: "ゆず故障",
          publisher: "ゆず故障",
          release_date: "2025-04-03",
          durationSeconds: 3_080,
        },
      ],
    );

    const config = makeConfig({
      scrape: {
        sites: [Website.FC2HUB, Website.PPVDATABANK],
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
          makeSiteResults([Website.DMM, { title: "Has title", thumb_url: undefined, poster_url: undefined }]),
        ),
        config: makeConfig(),
      },
    ];

    for (const { provider, config } of cases) {
      await expect(new AggregationService(provider).aggregate("ABF-075", config)).resolves.toBeNull();
    }
  });

  it("caches results until clearCache is called", async () => {
    const siteResults = makeSiteResults([Website.DMM, { thumb_url: "https://example.com/thumb.jpg" }]);

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
    const siteResults = makeSiteResults([
      Website.DMM,
      { number: undefined, thumb_url: "https://example.com/thumb.jpg" },
    ]);

    const provider = new RecordingCrawlerProvider(siteResults);
    const service = new AggregationService(provider);
    const config = makeConfig({
      scrape: { sites: [Website.DMM] },
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
    const siteResults = makeSiteResults(
      [Website.DMM, { title: "Fast DMM Title", thumb_url: "https://thumb.jpg" }],
      [Website.JAVDB, { title: "Slower JAVDB Title", thumb_url: "https://javdb-thumb.jpg" }],
    );

    const config = makeConfig({
      aggregation: { maxParallelCrawlers: 1 },
      download: { downloadSceneImages: false, generateNfo: false },
    });

    const provider = new MultiResultCrawlerProvider(siteResults);
    await new AggregationService(provider).aggregate("ABF-075", config);

    expect(provider.calledSites).toEqual([Website.DMM]);
  });

  it("forces manual URL scrapes to the selected site only", async () => {
    const siteResults = makeSiteResults(
      [Website.DMM, { title: "DMM Title" }],
      [Website.DMM_TV, { title: "DMM TV Title", thumb_url: "https://video.example/thumb.jpg" }],
      [Website.JAVDB, { title: "JAVDB Title" }],
    );
    const provider = new RecordingCrawlerProvider(siteResults);
    const config = makeConfig({
      scrape: { sites: [Website.DMM, Website.DMM_TV, Website.JAVDB] },
    });

    const result = await new AggregationService(provider).aggregate("ABF-075", config, undefined, {
      site: Website.DMM_TV,
    });

    expect(result?.data.website).toBe(Website.DMM_TV);
    expect(provider.calledSites).toEqual([Website.DMM_TV]);
    expect(provider.calledInputs[0]?.options?.detailUrl).toBeUndefined();
  });

  it("passes manual detail URLs to the forced crawler", async () => {
    const detailUrl = "https://video.dmm.co.jp/av/content/?id=1abf00075";
    const siteResults = makeSiteResults([Website.DMM_TV, { title: "DMM TV Title" }]);
    const provider = new RecordingCrawlerProvider(siteResults);

    await new AggregationService(provider).aggregate("ABF-075", makeConfig(), undefined, {
      site: Website.DMM_TV,
      detailUrl,
    });

    expect(provider.calledSites).toEqual([Website.DMM_TV]);
    expect(provider.calledInputs[0]?.options?.detailUrl).toBe(detailUrl);
  });

  it("limits FC2 numbers to the FC2 crawler family only", async () => {
    const siteResults = makeSiteResults(
      [Website.FC2, { title: "FC2 Title", number: "FC2-4775286", thumb_url: "https://fc2.example/thumb.jpg" }],
      [Website.FC2HUB, { title: "FC2HUB Title", number: "FC2-4775286" }],
      [Website.PPVDATABANK, { title: "PPVDATABANK FC2 Title", number: "FC2-4775286" }],
      [Website.JAVDB, { title: "JAVDB FC2 Title", number: "FC2-4775286" }],
    );

    const provider = new MultiResultCrawlerProvider(siteResults);
    const result = await new AggregationService(provider).aggregate(
      "FC2-4775286",
      makeConfig({
        scrape: {
          sites: [
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

  it("does not crawl Fantia without its required cookie", async () => {
    const provider = new RecordingCrawlerProvider(
      makeSiteResults([Website.DMM, { title: "DMM Title", thumb_url: "https://dmm.example/thumb.jpg" }]),
    );
    const config = makeConfig({
      scrape: { sites: [Website.FANTIA, Website.DMM] },
      network: { fantiaCookie: "" },
    });

    const result = await new AggregationService(provider).aggregate("ABF-075", config);

    expect(provider.calledSites).toEqual([Website.DMM]);
    expect(result?.stats.failedCount).toBe(0);
    expect(result?.stats.rejectedSites).toEqual([{ site: Website.FANTIA, reason: "missing_credential" }]);
  });

  it("skips FC2-only sites when aggregating a non-FC2 number", async () => {
    const siteResults = makeSiteResults(
      [Website.DMM, { title: "DMM Title", thumb_url: "https://dmm.example/thumb.jpg" }],
      [Website.JAVDB, { title: "JAVDB Title", thumb_url: "https://javdb.example/thumb.jpg" }],
      [Website.FC2, { title: "FC2 Title", thumb_url: "https://fc2.example/thumb.jpg" }],
      [Website.FC2HUB, { title: "FC2HUB Title", thumb_url: "https://fc2hub.example/thumb.jpg" }],
      [Website.PPVDATABANK, { title: "PPVDATABANK Title", thumb_url: "https://ppvdatabank.example/thumb.webp" }],
    );

    const provider = new MultiResultCrawlerProvider(siteResults);
    const result = await new AggregationService(provider).aggregate(
      "ABF-075",
      makeConfig({
        scrape: {
          sites: [Website.DMM, Website.FC2, Website.FC2HUB, Website.PPVDATABANK, Website.JAVDB],
        },
      }),
    );

    expect(result).not.toBeNull();
    expect(provider.calledSites.sort()).toEqual([Website.DMM, Website.JAVDB].sort());
  });

  it("aborts a slow crawler once its wall-clock budget is exhausted", async () => {
    const siteResults = makeSiteResults([
      Website.DMM,
      { title: "Slow DMM Title", thumb_url: "https://slow-thumb.jpg" },
    ]);

    const provider = new MultiResultCrawlerProvider(siteResults, {
      [Website.DMM]: 80,
    });
    const config = makeConfig({
      scrape: { sites: [Website.DMM] },
    });
    config.aggregation.maxParallelCrawlers = 1;
    config.aggregation.perCrawlerTimeoutMs = 20;
    config.aggregation.globalTimeoutMs = 100;

    const result = await new AggregationService(provider).aggregate("ABF-075", config);

    expect(result).toBeNull();
    expect(provider.calledSites).toEqual([Website.DMM]);
  });
});
