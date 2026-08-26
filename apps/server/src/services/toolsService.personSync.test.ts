import type { ActorLookupResult, ActorSourceProvider } from "@mdcz/runtime/actorSource";
import type { NetworkClient } from "@mdcz/runtime/network";
import { defaultConfiguration } from "@mdcz/shared/config";
import { describe, expect, it, vi } from "vitest";
import type { ServerConfigService } from "./configService";
import type { MediaRootService } from "./mediaRootService";
import type { ScrapeService } from "./scrapeService";
import { ToolsService } from "./toolsService";

const JELLYFIN_USER_ID = "123e4567-e89b-12d3-a456-426614174000";

const configuration = {
  ...defaultConfiguration,
  jellyfin: {
    ...defaultConfiguration.jellyfin,
    url: "http://127.0.0.1:8096",
    apiKey: "token",
    userId: JELLYFIN_USER_ID,
  },
};

const config = {
  get: async () => configuration,
} as ServerConfigService;

class FakeNetworkClient {
  readonly getJson = vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    if (path === "/Persons") {
      return { Items: [{ Id: "person-1", Name: "Actor A", Overview: "" }] };
    }
    if (path === `/Users/${JELLYFIN_USER_ID}/Items/person-1`) {
      return { Id: "person-1", Name: "Actor A", LockedFields: [], LockData: false };
    }
    throw new Error(`Unexpected URL ${url}`);
  });
  readonly getContent = vi.fn(async (_url: string, _init?: unknown) => new Uint8Array([0xff, 0xd8, 0xff]));
  readonly postText = vi.fn(async (_url: string, _body: string) => "");
  readonly registerSiteRequestConfigs = vi.fn();
}

class FakeActorSourceProvider {
  readonly lookup = vi.fn(
    async (_configuration: typeof configuration, query: string | { name: string }): Promise<ActorLookupResult> => {
      const name = typeof query === "string" ? query : query.name;
      return {
        profile: {
          name,
          description: "Actor biography",
          photo_url: "https://example.com/actor-a.jpg",
        },
        profileSources: { description: "official", photo_url: "gfriends" },
        sourceResults: [],
        warnings: [],
      };
    },
  );
}

const createTools = (networkClient: FakeNetworkClient, actorSourceProvider: FakeActorSourceProvider) =>
  new ToolsService(config, {} as MediaRootService, {} as ScrapeService, {
    networkClient: networkClient as unknown as NetworkClient,
    actorSourceProvider: actorSourceProvider as unknown as ActorSourceProvider,
  });

describe("ToolsService person sync", () => {
  it("syncs jellyfin actor info through the actor source provider", async () => {
    const networkClient = new FakeNetworkClient();
    const actorSourceProvider = new FakeActorSourceProvider();
    const tools = createTools(networkClient, actorSourceProvider);

    const response = await tools.execute({
      toolId: "media-library-tools",
      server: "jellyfin",
      action: "sync-info",
      mode: "missing",
    });

    expect(actorSourceProvider.lookup).toHaveBeenCalledWith(configuration, "Actor A");
    expect(response).toMatchObject({
      ok: true,
      message: "人物简介同步完成：1 成功，0 跳过，0 失败",
      data: { processedCount: 1, skippedCount: 0, failedCount: 0 },
    });
    const payload = JSON.parse(String(networkClient.postText.mock.calls[0]?.[1] ?? "{}")) as { Overview?: string };
    expect(payload.Overview).toContain("Actor biography");
  });

  it("syncs jellyfin actor photos through the actor source provider", async () => {
    const networkClient = new FakeNetworkClient();
    const actorSourceProvider = new FakeActorSourceProvider();
    const tools = createTools(networkClient, actorSourceProvider);

    const response = await tools.execute({
      toolId: "media-library-tools",
      server: "jellyfin",
      action: "sync-photo",
      mode: "missing",
    });

    expect(actorSourceProvider.lookup).toHaveBeenCalledWith(configuration, {
      name: "Actor A",
      requiredField: "photo_url",
    });
    expect(networkClient.getContent).toHaveBeenCalledWith("https://example.com/actor-a.jpg", expect.anything());
    expect(response).toMatchObject({
      ok: true,
      message: "人物头像同步完成：1 成功，0 跳过，0 失败",
      data: { processedCount: 1, skippedCount: 0, failedCount: 0 },
    });
  });
});
