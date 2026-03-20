import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PersistentCooldownStore } from "@main/services/cooldown/PersistentCooldownStore";
import { CrawlerProvider, FetchGateway } from "@main/services/crawler";
import type { CrawlerInput, CrawlerResponse, SiteAdapter } from "@main/services/crawler/base/types";
import { NetworkClient } from "@main/services/network";
import { Website } from "@shared/enums";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-crawler-provider-"));
  tempDirs.push(dirPath);
  return dirPath;
};

class StubCrawlerProvider extends CrawlerProvider {
  private readonly adapter: SiteAdapter;

  constructor(
    private readonly results: CrawlerResponse["result"][],
    siteCooldownStore: PersistentCooldownStore,
  ) {
    super({
      fetchGateway: new FetchGateway(new NetworkClient()),
      siteCooldownStore,
    });

    this.adapter = {
      site: () => Website.DMM,
      crawl: async (input: CrawlerInput): Promise<CrawlerResponse> => ({
        input,
        elapsedMs: 1,
        result: this.results.shift() ?? {
          success: true,
          data: {
            title: "Fallback Title",
            number: input.number,
            actors: [],
            genres: [],
            scene_images: [],
            website: input.site,
          },
        },
      }),
    };
  }

  override getCrawler(_site: Website): SiteAdapter | null {
    return this.adapter;
  }
}

describe("CrawlerProvider cooldowns", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map(async (dirPath) => {
        await rm(dirPath, { recursive: true, force: true });
      }),
    );
  });

  it("opens and persists a site cooldown immediately for deterministic failures", async () => {
    const root = await createTempDir();
    const storePath = join(root, "crawler-site-cooldowns.json");
    const store = new PersistentCooldownStore({
      filePath: storePath,
      loggerName: "CrawlerProviderTestStore",
    });
    const provider = new StubCrawlerProvider(
      [
        {
          success: false,
          error: "HTTP 403 Forbidden for https://example.com",
          failureReason: "unknown",
        },
      ],
      store,
    );

    await provider.crawl({
      number: "ABF-075",
      site: Website.DMM,
    });

    expect(provider.isSiteCoolingDown(Website.DMM)).toBe(true);

    await store.flush();

    const reloadedStore = new PersistentCooldownStore({
      filePath: storePath,
      loggerName: "CrawlerProviderTestStoreReloaded",
    });
    const reloadedProvider = new StubCrawlerProvider([], reloadedStore);

    expect(reloadedProvider.isSiteCoolingDown(Website.DMM)).toBe(true);

    const blocked = await reloadedProvider.crawl({
      number: "ABF-075",
      site: Website.DMM,
    });

    expect(blocked.result.success).toBe(false);
    if (blocked.result.success) {
      throw new Error("Expected cooldown response to fail");
    }
    expect(blocked.result.error).toContain("cooldown");
  });

  it("requires two transient failures before opening a site cooldown", async () => {
    const root = await createTempDir();
    const store = new PersistentCooldownStore({
      filePath: join(root, "crawler-site-cooldowns.json"),
      loggerName: "CrawlerProviderTransientStore",
    });
    const provider = new StubCrawlerProvider(
      [
        {
          success: false,
          error: "Request timeout",
          failureReason: "timeout",
        },
        {
          success: false,
          error: "tls handshake eof",
          failureReason: "unknown",
        },
      ],
      store,
    );

    await provider.crawl({
      number: "ABF-075",
      site: Website.DMM,
    });
    expect(provider.isSiteCoolingDown(Website.DMM)).toBe(false);

    await provider.crawl({
      number: "ABF-075",
      site: Website.DMM,
    });
    expect(provider.isSiteCoolingDown(Website.DMM)).toBe(true);

    await store.flush();
  });

  it("treats Cloudflare challenge failures as deterministic cooldowns", async () => {
    const root = await createTempDir();
    const store = new PersistentCooldownStore({
      filePath: join(root, "crawler-site-cooldowns.json"),
      loggerName: "CrawlerProviderCloudflareStore",
    });
    const provider = new StubCrawlerProvider(
      [
        {
          success: false,
          error: "FC2HUB blocked by Cloudflare challenge",
          failureReason: "unknown",
        },
      ],
      store,
    );

    await provider.crawl({
      number: "FC2-4515706",
      site: Website.FC2HUB,
    });

    expect(provider.isSiteCoolingDown(Website.FC2HUB)).toBe(true);
  });
});
