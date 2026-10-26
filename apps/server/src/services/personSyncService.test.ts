import type { ActorLookupResult, ActorSourceProvider } from "@mdcz/runtime/actorSource";
import { PersonSyncLock } from "@mdcz/runtime/mediaserver";
import type { NetworkClient } from "@mdcz/runtime/network";
import { defaultConfiguration } from "@mdcz/shared/config";
import type { PersonSyncJobDto } from "@mdcz/shared/serverDtos";
import { describe, expect, it, vi } from "vitest";
import { createTaskEventBus } from "../taskEvents";
import type { ServerConfigService } from "./configService";
import { PersonSyncService } from "./personSyncService";

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

const createSubject = (networkClient = new FakeNetworkClient()) => {
  const actorSourceProvider = new FakeActorSourceProvider();
  const taskEvents = createTaskEventBus();
  const published: PersonSyncJobDto[] = [];
  taskEvents.subscribe((notification) => {
    if (notification.kind === "person-sync") published.push(notification.job);
  });
  const service = new PersonSyncService(config, taskEvents, {
    networkClient: networkClient as unknown as NetworkClient,
    actorSourceProvider: actorSourceProvider as unknown as ActorSourceProvider,
    lock: new PersonSyncLock(),
  });
  const settled = async () => {
    await expect.poll(() => service.status()?.status).not.toBe("running");
    return service.status();
  };
  return { actorSourceProvider, networkClient, published, service, settled };
};

describe("PersonSyncService", () => {
  it("runs one sync in the background, joins repeat starts, and publishes its outcome", async () => {
    const { actorSourceProvider, networkClient, published, service, settled } = createSubject();

    const started = service.start({ server: "jellyfin", kind: "info", mode: "missing" });
    const joined = service.start({ server: "jellyfin", kind: "photo", mode: "all" });

    expect(started).toMatchObject({ status: "running", kind: "info", result: null });
    expect(joined.id).toBe(started.id);
    expect(service.status()?.id).toBe(started.id);

    const finished = await settled();
    expect(finished).toMatchObject({
      id: started.id,
      status: "completed",
      result: { processedCount: 1, skippedCount: 0, failedCount: 0 },
      error: null,
    });
    expect(finished?.finishedAt).not.toBeNull();
    expect(published.at(0)?.status).toBe("running");
    expect(published.at(-1)).toEqual(finished);
    expect(actorSourceProvider.lookup).toHaveBeenCalledWith(configuration, "Actor A");
    const payload = JSON.parse(String(networkClient.postText.mock.calls[0]?.[1] ?? "{}")) as { Overview?: string };
    expect(payload.Overview).toContain("Actor biography");
  });

  it("keeps a failed sync as the last job and lets the next start run a new one", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockRejectedValueOnce(new Error("Jellyfin is offline"));
    const { actorSourceProvider, service, settled } = createSubject(networkClient);

    const failed = service.start({ server: "jellyfin", kind: "photo", mode: "missing" });
    expect(await settled()).toMatchObject({ id: failed.id, status: "failed", result: null });
    expect(service.status()?.error).toBeTruthy();

    const retried = service.start({ server: "jellyfin", kind: "photo", mode: "missing" });
    expect(retried.id).not.toBe(failed.id);
    expect(await settled()).toMatchObject({
      id: retried.id,
      status: "completed",
      result: { processedCount: 1, skippedCount: 0, failedCount: 0 },
    });
    expect(actorSourceProvider.lookup).toHaveBeenCalledWith(configuration, {
      name: "Actor A",
      requiredField: "photo_url",
    });
    expect(networkClient.getContent).toHaveBeenCalledWith("https://example.com/actor-a.jpg", expect.anything());
  });
});
