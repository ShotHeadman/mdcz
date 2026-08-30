import { join } from "node:path";
import type { PersistentCooldownStore } from "@mdcz/runtime/cooldown";
import type { CrawlerProvider } from "@mdcz/runtime/crawler";
import type { NetworkClient } from "@mdcz/runtime/network";
import { ProxyType, Website } from "@mdcz/shared/enums";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTempDirectory } from "../../../tests/harness/tempDirectory";
import { buildServer, type ServerApp } from "./app";
import { ServerConfigService } from "./services/configService";
import type { ServerPersistenceService } from "./services/persistenceService";

const fakePersistenceState = {
  database: {},
  repositories: { scanTasks: { interruptUnfinished: async () => [] } },
};
const fakePersistence = {
  initialize: async () => fakePersistenceState,
  getState: async () => fakePersistenceState,
  close: async () => undefined,
  get initialized() {
    return true;
  },
} as unknown as ServerPersistenceService;

describe("server resource graph", () => {
  const apps: ServerApp[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(apps.splice(0).map(async (app) => await app.fastify.close()));
  });

  it("applies live proxy, timeout, and retry values to requests after config changes", async () => {
    const directory = await createTempDirectory("server-live-network");
    const paths = {
      configDir: join(directory.path, "config"),
      dataDir: join(directory.path, "data"),
      configPath: join(directory.path, "config", "default.toml"),
      databasePath: join(directory.path, "data", "mdcz.sqlite"),
    };
    const config = new ServerConfigService(paths);
    const app = buildServer({
      webStaticDir: false,
      services: { config, persistence: fakePersistence },
    });
    apps.push(app);
    await app.fastify.ready();
    const fetch = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response("unavailable", { status: 429, headers: { "retry-after": "1" } }),
    );
    const constructorSpy = vi.fn();
    (
      globalThis as typeof globalThis & {
        __mdczImpitMock?: { fetch: typeof fetch; constructorSpy: typeof constructorSpy };
      }
    ).__mdczImpitMock = { fetch, constructorSpy };

    await app.services.config.update({
      network: {
        useProxy: true,
        proxyType: ProxyType.HTTP,
        proxy: "127.0.0.1:9",
        timeout: 7,
        retryCount: 3,
      },
    });

    const networkClient = (app.services.runtimeActions as unknown as { networkClient: NetworkClient }).networkClient;
    vi.useFakeTimers();
    const request = networkClient.getText("https://example.com/live-network").catch(() => undefined);
    for (let retry = 0; retry < 4; retry += 1) {
      await vi.runAllTimersAsync();
    }
    await request;

    expect(constructorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ proxyUrl: "http://127.0.0.1:9", timeout: 7_000 }),
    );
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ timeout: 7_000 });
    vi.useRealTimers();
    delete (globalThis as typeof globalThis & { __mdczImpitMock?: unknown }).__mdczImpitMock;
    await directory.cleanup();
  });

  it("shares one crawler provider across runtime actions and shuts it down once", async () => {
    const crawlerProvider = {
      listSites: vi.fn(() => [{ site: Website.JAVDB, native: true }]),
      shutdown: vi.fn(async () => undefined),
    };
    const imageHostCooldownStore = {
      flush: vi.fn(async () => undefined),
      clear: vi.fn(),
    };
    const directory = await createTempDirectory("server-resources");
    const paths = {
      configDir: join(directory.path, "config"),
      dataDir: join(directory.path, "data"),
      configPath: join(directory.path, "config", "default.toml"),
      databasePath: join(directory.path, "data", "mdcz.sqlite"),
    };
    const config = new ServerConfigService(paths);
    const app = buildServer({
      webStaticDir: false,
      services: { config, persistence: fakePersistence },
      resources: {
        crawlerProvider: crawlerProvider as unknown as CrawlerProvider,
        imageHostCooldownStore: imageHostCooldownStore as unknown as PersistentCooldownStore,
      },
    });
    apps.push(app);

    await app.fastify.ready();
    const sites = await app.services.runtimeActions.listCrawlerSites();
    expect(sites.sites).toEqual([{ site: Website.JAVDB, name: "javdb", enabled: true, native: true }]);
    expect(crawlerProvider.listSites).toHaveBeenCalledTimes(1);

    await app.fastify.close();
    await app.fastify.close();
    await directory.cleanup();

    expect(crawlerProvider.shutdown).toHaveBeenCalledTimes(1);
    expect(imageHostCooldownStore.flush).toHaveBeenCalledTimes(1);
  });
});
