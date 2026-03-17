import type { ActorLookupResult, ActorSourceProvider } from "@main/services/actorSource";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { checkConnection, EmbyActorInfo, EmbyActorPhoto } from "@main/services/emby";
import type { NetworkClient } from "@main/services/network";
import { SignalService } from "@main/services/SignalService";
import { describe, expect, it, vi } from "vitest";

const createConfig = (overrides: Record<string, unknown> = {}) =>
  configurationSchema.parse({
    ...defaultConfiguration,
    ...overrides,
  });

const createEmbyConfig = (overrides: { emby?: Record<string, unknown>; personSync?: Record<string, unknown> } = {}) =>
  createConfig({
    ...overrides,
    personSync: {
      ...defaultConfiguration.personSync,
      ...(overrides.personSync ?? {}),
    },
    emby: {
      ...defaultConfiguration.emby,
      url: "http://127.0.0.1:8096",
      apiKey: "token",
      ...(overrides.emby ?? {}),
    },
  });

class FakeNetworkClient {
  readonly getJson = vi.fn(async (_url: string) => ({}));

  readonly getContent = vi.fn(async (_url: string) => new Uint8Array());

  readonly postText = vi.fn(async (_url: string, _body: string) => "");
}

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

const createInfoService = (networkClient: FakeNetworkClient, actorSourceProvider: FakeActorSourceProvider) =>
  new EmbyActorInfo({
    signalService: new SignalService(null),
    networkClient: networkClient as unknown as NetworkClient,
    actorSourceProvider: actorSourceProvider as unknown as ActorSourceProvider,
  });

const createPhotoService = (networkClient: FakeNetworkClient, actorSourceProvider: FakeActorSourceProvider) =>
  new EmbyActorPhoto({
    signalService: new SignalService(null),
    networkClient: networkClient as unknown as NetworkClient,
    actorSourceProvider: actorSourceProvider as unknown as ActorSourceProvider,
  });

const createStructuredLookupResult = (name = "神木麗"): ActorLookupResult => ({
  profile: {
    name,
    aliases: ["神木れい", "かみきれい"],
    birth_date: "1999-12-20",
    birth_place: "埼玉県",
    blood_type: "A",
    description: "官方简介",
    height_cm: 169,
    bust_cm: 95,
    waist_cm: 60,
    hip_cm: 85,
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

const expectStructuredActorPayload = (
  payload: Record<string, unknown>,
  overview: string,
  options: {
    tags?: string[];
    taglines?: string[];
    premiereDate?: string;
  } = {},
): void => {
  expect(payload).toMatchObject({
    Overview: overview,
    Tags: options.tags ?? [],
    Taglines: options.taglines ?? [],
    PremiereDate: options.premiereDate ?? "1999-12-20T00:00:00.000Z",
    ProductionYear: 1999,
    ProductionLocations: ["埼玉県"],
  });
};

describe("Emby actor services", () => {
  it("returns layered diagnostics and an admin-key hint for a healthy Emby connection", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(async (url: string) => {
      const path = new URL(url).pathname;
      if (path === "/System/Info/Public") {
        return { ServerName: "Emby", Version: "4.9.0.41" };
      }
      if (path === "/Users/Me") {
        return { Id: "user-1" };
      }
      if (path === "/Persons") {
        return { Items: [{ Id: "person-1", Name: "神木麗", Overview: "" }] };
      }
      if (path === "/Items/person-1/MetadataEditor") {
        return {};
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const result = await checkConnection(networkClient as unknown as NetworkClient, createEmbyConfig());

    expect(result.success).toBe(true);
    expect(result.serverInfo).toEqual({ serverName: "Emby", version: "4.9.0.41" });
    expect(result.steps.map((step) => [step.key, step.status])).toEqual([
      ["server", "ok"],
      ["auth", "ok"],
      ["peopleRead", "ok"],
      ["peopleWrite", "ok"],
      ["adminKey", "skipped"],
    ]);
    expect(result.steps[4]?.message).toContain("管理员 API Key");
  });

  it("updates actor info from the shared actor source provider", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/Persons") {
        return { Items: [{ Id: "person-1", Name: "神木麗" }] };
      }
      if (parsed.pathname === "/Items/person-1") {
        return { Id: "person-1", Name: "神木麗", Overview: "", DateCreated: "2026-01-01T00:00:00.0000000Z" };
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const actorSourceProvider = new FakeActorSourceProvider();
    actorSourceProvider.lookup.mockResolvedValue(createStructuredLookupResult());

    const service = createInfoService(networkClient, actorSourceProvider);

    const result = await service.run(createEmbyConfig(), "all");

    expect(result).toEqual({ processedCount: 1, failedCount: 0 });
    expect(actorSourceProvider.lookup).toHaveBeenCalledWith(expect.any(Object), "神木麗");
    expect(networkClient.postText).toHaveBeenCalledTimes(2);
    expect(networkClient.postText.mock.calls[0]?.[0]).toContain("/Items/person-1?");
    expect(networkClient.postText.mock.calls[1]?.[0]).toContain("/Items/person-1/Refresh");
    expectStructuredActorPayload(
      readPostedPayload(networkClient),
      "基本资料\n血型：A型\n身高：169cm\n三围：B95 W60 H85\n罩杯：G杯\n\n官方简介\n\n别名：神木れい / かみきれい",
    );
    expect(readPostedPayload(networkClient)).not.toHaveProperty("DateCreated");
  });

  it("fills missing actor native fields and summary in missing mode without overwriting the overview body", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/Persons") {
        return { Items: [{ Id: "person-1", Name: "神木麗" }] };
      }
      if (parsed.pathname === "/Items/person-1") {
        return { Id: "person-1", Name: "神木麗", Overview: "已有简介", Tags: ["favorite"], Taglines: [] };
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const actorSourceProvider = new FakeActorSourceProvider();
    actorSourceProvider.lookup.mockResolvedValue(createStructuredLookupResult());

    const service = createInfoService(networkClient, actorSourceProvider);

    const result = await service.run(createEmbyConfig(), "missing");

    expect(result).toEqual({ processedCount: 1, failedCount: 0 });
    expectStructuredActorPayload(
      readPostedPayload(networkClient),
      "基本资料\n血型：A型\n身高：169cm\n三围：B95 W60 H85\n罩杯：G杯\n\n已有简介\n\n别名：神木れい / かみきれい",
      { tags: ["favorite"] },
    );
  });

  it("appends aliases to the existing overview in all mode when the source has no description", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/Persons") {
        return { Items: [{ Id: "person-1", Name: "神木麗" }] };
      }
      if (parsed.pathname === "/Items/person-1") {
        return { Id: "person-1", Name: "神木麗", Overview: "已有简介\n\n别名：旧别名" };
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const actorSourceProvider = new FakeActorSourceProvider();
    actorSourceProvider.lookup.mockResolvedValue({
      profile: {
        name: "神木麗",
        aliases: ["神木れい", "かみきれい"],
      },
      profileSources: {},
      sourceResults: [],
      warnings: [],
    });

    const service = createInfoService(networkClient, actorSourceProvider);

    const result = await service.run(createEmbyConfig(), "all");

    expect(result).toEqual({ processedCount: 1, failedCount: 0 });
    expect(readPostedPayload(networkClient)).toMatchObject({
      Overview: "已有简介\n\n别名：神木れい / かみきれい",
    });
  });

  it("preserves existing Emby production fields in the update payload", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/Persons") {
        return { Items: [{ Id: "person-1", Name: "神木麗" }] };
      }
      if (parsed.pathname === "/Items/person-1") {
        return {
          Id: "person-1",
          Name: "神木麗",
          Overview: "",
          PremiereDate: "1999-12-20T00:00:00.0000000Z",
          ProductionLocations: ["埼玉県"],
          ProductionYear: 1999,
        };
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const actorSourceProvider = new FakeActorSourceProvider();
    actorSourceProvider.lookup.mockResolvedValue(createStructuredLookupResult());

    const service = createInfoService(networkClient, actorSourceProvider);

    await service.run(createEmbyConfig(), "all");

    expect(readPostedPayload(networkClient)).toMatchObject({
      PremiereDate: "1999-12-20T00:00:00.0000000Z",
      ProductionLocations: ["埼玉県"],
      ProductionYear: 1999,
    });
  });

  it("cleans legacy managed tags and taglines in missing mode while preserving user entries", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/Persons") {
        return { Items: [{ Id: "person-1", Name: "神木麗" }] };
      }
      if (parsed.pathname === "/Items/person-1") {
        return {
          Id: "person-1",
          Name: "神木麗",
          Overview:
            "基本资料\n血型：A型\n身高：169cm\n三围：B95 W60 H85\n罩杯：G杯\n\n已有简介\n\n别名：神木れい / かみきれい",
          Tags: ["favorite", "mdcz:birth_date:1999-12-20"],
          Taglines: ["精选", "MDCz: 1999-12-20"],
          PremiereDate: "1999-12-20T00:00:00.0000000Z",
          ProductionLocations: ["埼玉県"],
          ProductionYear: 1999,
        };
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const actorSourceProvider = new FakeActorSourceProvider();
    actorSourceProvider.lookup.mockResolvedValue(createStructuredLookupResult());

    const service = createInfoService(networkClient, actorSourceProvider);

    const result = await service.run(createEmbyConfig(), "missing");

    expect(result).toEqual({ processedCount: 1, failedCount: 0 });
    expect(actorSourceProvider.lookup).toHaveBeenCalledWith(expect.any(Object), "神木麗");
    expect(networkClient.postText).toHaveBeenCalledTimes(2);
    expectStructuredActorPayload(
      readPostedPayload(networkClient),
      "基本资料\n血型：A型\n身高：169cm\n三围：B95 W60 H85\n罩杯：G杯\n\n已有简介\n\n别名：神木れい / かみきれい",
      {
        tags: ["favorite"],
        taglines: ["精选"],
        premiereDate: "1999-12-20T00:00:00.0000000Z",
      },
    );
  });

  it("uploads actor photos from the shared actor source provider", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/Persons") {
        return { Items: [{ Id: "person-1", Name: "神木麗", ImageTags: {} }] };
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    networkClient.getContent.mockResolvedValue(new TextEncoder().encode("photo-bytes"));

    const actorSourceProvider = new FakeActorSourceProvider();
    actorSourceProvider.lookup.mockResolvedValue({
      profile: {
        name: "神木麗",
        photo_url: "https://static.mgstage.com/mgs/img/common/actress/%E7%A5%9E%E6%9C%A8%E9%BA%97.jpg",
      },
      profileSources: {
        photo_url: "official",
      },
      sourceResults: [],
      warnings: [],
    });

    const service = createPhotoService(networkClient, actorSourceProvider);

    const result = await service.run(
      createEmbyConfig({
        personSync: {
          personImageSources: ["official"],
        },
      }),
      "all",
    );

    expect(result).toEqual({ processedCount: 1, failedCount: 0 });
    expect(actorSourceProvider.lookup).toHaveBeenCalledWith(expect.any(Object), {
      name: "神木麗",
      requiredField: "photo_url",
    });
    expect(networkClient.getContent).toHaveBeenCalledWith(
      "https://static.mgstage.com/mgs/img/common/actress/%E7%A5%9E%E6%9C%A8%E9%BA%97.jpg",
      {
        headers: {
          accept: "image/*",
        },
      },
    );
    expect(networkClient.postText).toHaveBeenCalledTimes(2);
    expect(networkClient.postText.mock.calls[0]?.[0]).toContain("/Items/person-1/Images/Primary?");
    expect(networkClient.postText.mock.calls[1]?.[0]).toContain("/Items/person-1/Refresh");
  });
});
