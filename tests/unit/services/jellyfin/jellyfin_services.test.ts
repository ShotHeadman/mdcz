import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ActorLookupResult,
  ActorSourceProvider,
  ActorSourceRegistry,
  GfriendsActorSource,
  LocalActorSource,
} from "@main/services/actorSource";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { ActorPhotoFolderConfigurationError } from "@main/services/config/actorPhotoPath";
import { checkConnection, JellyfinActorInfoService, JellyfinActorPhotoService } from "@main/services/jellyfin";
import type { NetworkClient } from "@main/services/network";
import { SignalService } from "@main/services/SignalService";
import { app } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-jellyfin-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const createUserDataDir = async (): Promise<string> => {
  const userDataDir = await createTempDir();
  vi.spyOn(app, "getPath").mockReturnValue(userDataDir);
  return userDataDir;
};

const createConfig = (overrides: Record<string, unknown> = {}) =>
  configurationSchema.parse({
    ...defaultConfiguration,
    ...overrides,
  });

class FakeNetworkClient {
  readonly getJson = vi.fn(async (_url: string) => ({}));
  readonly getContent = vi.fn(async (_url: string) => new Uint8Array());
  readonly postContent = vi.fn(async (_url: string, _body: Uint8Array) => undefined);
  readonly postText = vi.fn(async (_url: string, _body: string) => "");
}

const createActorSourceProvider = (
  networkClient: FakeNetworkClient,
  actorMapUrl = "https://example.com/empty-map.json",
) =>
  new ActorSourceProvider({
    registry: new ActorSourceRegistry([
      new LocalActorSource(),
      new GfriendsActorSource({
        networkClient: networkClient as unknown as NetworkClient,
        actorMapUrl,
      }),
    ]),
  });

class FakeActorSourceProvider {
  readonly lookup = vi.fn(
    async (_configuration: ReturnType<typeof createConfig>, name: string): Promise<ActorLookupResult> => ({
      profile: {
        name,
      },
      profileSources: {},
      sourceResults: [],
      warnings: [],
    }),
  );
}

const createStructuredLookupResult = (name = "Actor A"): ActorLookupResult => ({
  profile: {
    name,
    aliases: ["Alias A", "Alias B"],
    birth_date: "2001-02-03",
    birth_place: "東京都",
    blood_type: "A",
    description: "Actor biography",
    height_cm: 160,
    bust_cm: 90,
    waist_cm: 58,
    hip_cm: 88,
    cup_size: "G",
  },
  profileSources: {
    description: "official",
  },
  sourceResults: [],
  warnings: [],
});

const readPostedPayload = (networkClient: FakeNetworkClient, index = 0): Record<string, unknown> => {
  const body = networkClient.postText.mock.calls[index]?.[1];
  return JSON.parse(typeof body === "string" ? body : "{}");
};

const expectManagedActorPayload = (payload: Record<string, unknown>, overview: string): void => {
  expect(payload).toMatchObject({
    Overview: overview,
    Taglines: ["MDCz: 2001-02-03 / 東京都 / A型 / 160cm / B90 W58 H88 / Gカップ"],
    PremiereDate: "2001-02-03T00:00:00.000Z",
    ProductionYear: 2001,
    ProductionLocations: ["東京都"],
  });
  expect(payload.Tags).toEqual(
    expect.arrayContaining([
      "mdcz:birth_date:2001-02-03",
      "mdcz:birth_place:東京都",
      "mdcz:blood_type:A",
      "mdcz:height_cm:160",
      "mdcz:bust_cm:90",
      "mdcz:waist_cm:58",
      "mdcz:hip_cm:88",
      "mdcz:cup_size:G",
    ]),
  );
};

describe("Jellyfin services", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map(async (dirPath) => {
        await rm(dirPath, { recursive: true, force: true });
      }),
    );
  });

  it("returns layered diagnostics for a healthy Jellyfin connection", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      const path = parsed.pathname;
      if (path === "/System/Info/Public") {
        return { ServerName: "Jellyfin", Version: "10.11.2" };
      }
      if (path === "/System/Info") {
        return { Version: "10.11.2" };
      }
      if (path === "/Persons") {
        expect(parsed.searchParams.get("personTypes")).toBe("Actor");
        return { Items: [{ Id: "person-1", Name: "Actor A", Overview: "" }] };
      }
      if (path === "/Items/person-1/MetadataEditor") {
        return {};
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const result = await checkConnection(
      networkClient as unknown as NetworkClient,
      createConfig({
        jellyfin: {
          ...defaultConfiguration.jellyfin,
          url: "http://127.0.0.1:8096",
          apiKey: "token",
        },
      }),
    );

    expect(result.success).toBe(true);
    expect(result.serverInfo).toEqual({ serverName: "Jellyfin", version: "10.11.2" });
    expect(result.steps.map((step) => [step.key, step.status])).toEqual([
      ["server", "ok"],
      ["auth", "ok"],
      ["peopleRead", "ok"],
      ["peopleWrite", "ok"],
    ]);
  });

  it("marks auth failure and skips people checks when /System/Info is unauthorized", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(async (url: string) => {
      const path = new URL(url).pathname;
      if (path === "/System/Info/Public") {
        return { ServerName: "Jellyfin", Version: "10.11.2" };
      }
      if (path === "/System/Info") {
        throw new Error(`HTTP 401 Unauthorized for ${url}`);
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const result = await checkConnection(
      networkClient as unknown as NetworkClient,
      createConfig({
        jellyfin: {
          ...defaultConfiguration.jellyfin,
          url: "http://127.0.0.1:8096",
          apiKey: "token",
        },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.steps.map((step) => [step.key, step.status])).toEqual([
      ["server", "ok"],
      ["auth", "error"],
      ["peopleRead", "skipped"],
      ["peopleWrite", "skipped"],
    ]);
  });

  it("classifies /System/Info server errors as service failures instead of auth failures", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(async (url: string) => {
      const path = new URL(url).pathname;
      if (path === "/System/Info/Public") {
        return { ServerName: "Jellyfin", Version: "10.11.2" };
      }
      if (path === "/System/Info") {
        throw new Error(`HTTP 500 Internal Server Error for ${url}`);
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const result = await checkConnection(
      networkClient as unknown as NetworkClient,
      createConfig({
        jellyfin: {
          ...defaultConfiguration.jellyfin,
          url: "http://127.0.0.1:8096",
          apiKey: "token",
        },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.steps[1]).toMatchObject({
      key: "auth",
      status: "error",
      code: "JELLYFIN_UNREACHABLE",
    });
  });

  it("uses local actor overview sources, can lock Overview, and refreshes the person after a successful update", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/Persons") {
        return { Items: [{ Id: "person-1", Name: "Actor A", Overview: "" }] };
      }
      if (parsed.pathname === "/Items/person-1") {
        return { Id: "person-1", Name: "Actor A", LockedFields: [], LockData: false };
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const actorSourceProvider = new FakeActorSourceProvider();
    actorSourceProvider.lookup.mockResolvedValue(createStructuredLookupResult());

    const service = new JellyfinActorInfoService({
      signalService: new SignalService(null),
      networkClient: networkClient as unknown as NetworkClient,
      actorSourceProvider: actorSourceProvider as unknown as ActorSourceProvider,
    });

    const result = await service.run(
      createConfig({
        personSync: {
          ...defaultConfiguration.personSync,
          personOverviewSources: ["official"],
        },
        jellyfin: {
          ...defaultConfiguration.jellyfin,
          url: "http://127.0.0.1:8096",
          apiKey: "token",
          refreshPersonAfterSync: true,
          lockOverviewAfterSync: true,
        },
      }),
      "all",
    );

    expect(result).toEqual({ processedCount: 1, failedCount: 0 });
    expect(networkClient.postText).toHaveBeenCalledTimes(2);
    expect(networkClient.postText.mock.calls[0]?.[0]).toContain("/Items/person-1?");
    expectManagedActorPayload(
      readPostedPayload(networkClient),
      "基本资料\n生日：2001-02-03\n出生地：東京都\n血型：A型\n身高：160cm\n三围：B90 W58 H88\n罩杯：G杯\n\nActor biography\n\n别名：Alias A / Alias B",
    );
    expect(readPostedPayload(networkClient)).toMatchObject({
      LockedFields: ["Overview"],
      LockData: true,
    });
    expect(networkClient.postText.mock.calls[1]?.[0]).toContain("/Items/person-1/Refresh");
  });

  it("fills missing actor tags and summary without overwriting an existing Jellyfin overview", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/Persons") {
        return { Items: [{ Id: "person-1", Name: "Actor A", Overview: "已有简介" }] };
      }
      if (parsed.pathname === "/Items/person-1") {
        return {
          Id: "person-1",
          Name: "Actor A",
          Overview: "已有简介",
          Tags: ["favorite"],
          Taglines: [],
          LockedFields: [],
          LockData: false,
        };
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const actorSourceProvider = new FakeActorSourceProvider();
    actorSourceProvider.lookup.mockResolvedValue(createStructuredLookupResult());

    const service = new JellyfinActorInfoService({
      signalService: new SignalService(null),
      networkClient: networkClient as unknown as NetworkClient,
      actorSourceProvider: actorSourceProvider as unknown as ActorSourceProvider,
    });

    const result = await service.run(
      createConfig({
        personSync: {
          ...defaultConfiguration.personSync,
          personOverviewSources: ["official"],
        },
        jellyfin: {
          ...defaultConfiguration.jellyfin,
          url: "http://127.0.0.1:8096",
          apiKey: "token",
          refreshPersonAfterSync: false,
        },
      }),
      "missing",
    );

    expect(result).toEqual({ processedCount: 1, failedCount: 0 });
    expect(networkClient.postText).toHaveBeenCalledTimes(1);
    expectManagedActorPayload(readPostedPayload(networkClient), "已有简介");
  });

  it("appends aliases to the existing overview in all mode when the source has no description", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/Persons") {
        return { Items: [{ Id: "person-1", Name: "Actor A", Overview: "已有简介\n\n别名：旧别名" }] };
      }
      if (parsed.pathname === "/Items/person-1") {
        return {
          Id: "person-1",
          Name: "Actor A",
          Overview: "已有简介\n\n别名：旧别名",
          LockedFields: [],
          LockData: false,
        };
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const actorSourceProvider = new FakeActorSourceProvider();
    actorSourceProvider.lookup.mockResolvedValue({
      profile: {
        name: "Actor A",
        aliases: ["Alias A", "Alias B"],
      },
      profileSources: {},
      sourceResults: [],
      warnings: [],
    });

    const service = new JellyfinActorInfoService({
      signalService: new SignalService(null),
      networkClient: networkClient as unknown as NetworkClient,
      actorSourceProvider: actorSourceProvider as unknown as ActorSourceProvider,
    });

    const result = await service.run(
      createConfig({
        personSync: {
          ...defaultConfiguration.personSync,
          personOverviewSources: ["official"],
        },
        jellyfin: {
          ...defaultConfiguration.jellyfin,
          url: "http://127.0.0.1:8096",
          apiKey: "token",
        },
      }),
      "all",
    );

    expect(result).toEqual({ processedCount: 1, failedCount: 0 });
    expect(readPostedPayload(networkClient)).toMatchObject({
      Overview: "已有简介\n\n别名：Alias A / Alias B",
    });
  });

  it("uploads actor photos as base64 text and falls back to the indexed image endpoint", async () => {
    const root = await createTempDir();
    await createUserDataDir();
    const photoPath = join(root, "Actor A.jpg");
    await writeFile(photoPath, "photo-bytes", "utf8");

    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/Persons") {
        return { Items: [{ Id: "person-1", Name: "Actor A" }] };
      }
      if (url === "https://example.com/empty-map.json") {
        return { Content: {} };
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    networkClient.postText
      .mockRejectedValueOnce(
        new Error("HTTP 405 Method Not Allowed for http://127.0.0.1:8096/Items/person-1/Images/Primary"),
      )
      .mockResolvedValueOnce("");

    const service = new JellyfinActorPhotoService({
      signalService: new SignalService(null),
      networkClient: networkClient as unknown as NetworkClient,
      actorSourceProvider: createActorSourceProvider(networkClient),
    });

    const result = await service.run(
      createConfig({
        paths: {
          ...defaultConfiguration.paths,
          actorPhotoFolder: root,
        },
        personSync: {
          ...defaultConfiguration.personSync,
          personImageSources: ["local", "gfriends"],
        },
        jellyfin: {
          ...defaultConfiguration.jellyfin,
          url: "http://127.0.0.1:8096",
          apiKey: "token",
          refreshPersonAfterSync: true,
        },
      }),
      "all",
    );

    expect(result).toEqual({ processedCount: 1, failedCount: 0 });
    expect(networkClient.postContent).not.toHaveBeenCalled();
    expect(networkClient.postText).toHaveBeenCalledTimes(3);

    const [firstUrl, firstBody] = networkClient.postText.mock.calls[0];
    const [secondUrl, secondBody] = networkClient.postText.mock.calls[1];
    const [refreshUrl] = networkClient.postText.mock.calls[2];
    expect(firstUrl).toContain("/Items/person-1/Images/Primary");
    expect(secondUrl).toContain("/Items/person-1/Images/Primary/0");
    expect(refreshUrl).toContain("/Items/person-1/Refresh");
    expect(firstBody).toBe(Buffer.from(await readFile(photoPath)).toString("base64"));
    expect(secondBody).toBe(firstBody);
  });

  it("fails fast when local actor photos use a relative path without mediaPath", async () => {
    const networkClient = new FakeNetworkClient();
    const service = new JellyfinActorPhotoService({
      signalService: new SignalService(null),
      networkClient: networkClient as unknown as NetworkClient,
      actorSourceProvider: createActorSourceProvider(networkClient),
    });

    await expect(
      service.run(
        createConfig({
          paths: {
            ...defaultConfiguration.paths,
            mediaPath: "",
            actorPhotoFolder: "actor-library",
          },
          personSync: {
            ...defaultConfiguration.personSync,
            personImageSources: ["local", "gfriends"],
          },
          jellyfin: {
            ...defaultConfiguration.jellyfin,
            url: "http://127.0.0.1:8096",
            apiKey: "token",
          },
        }),
        "all",
      ),
    ).rejects.toBeInstanceOf(ActorPhotoFolderConfigurationError);
    expect(networkClient.getJson).not.toHaveBeenCalled();
  });
});
