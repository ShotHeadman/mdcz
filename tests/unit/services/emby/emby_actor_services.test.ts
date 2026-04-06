import type { ActorLookupResult, ActorSourceProvider } from "@main/services/actorSource";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { checkConnection, EmbyActorInfo, EmbyActorPhoto } from "@main/services/mediaServer/emby";
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

const embyUserId = "user-1";
const ACTOR_PERSON_TYPES_QUERY = "Actor,GuestStar";

class FakeNetworkClient {
  readonly getJson = vi.fn(async (_url: string): Promise<unknown> => ({}));

  readonly getContent = vi.fn(async (_url: string) => new Uint8Array());

  readonly postText = vi.fn(async (_url: string, _body: string) => "");
}

class FakeActorSourceProvider {
  readonly lookup = vi.fn(
    async (
      _configuration: ReturnType<typeof createConfig>,
      query: string | { name: string },
    ): Promise<ActorLookupResult> => ({
      profile: {
        name: typeof query === "string" ? query : query.name,
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

const createAdminUsersQueryResponse = () => ({
  Items: [{ Id: embyUserId, Policy: { IsAdministrator: true, EnableAllFolders: true } }],
});

interface MockGetJsonOptions {
  systemInfoPublic?: Record<string, unknown>;
  systemEndpoint?: Record<string, unknown>;
  usersQuery?: Record<string, unknown>;
  persons?: unknown[];
  filteredPersons?: unknown[];
  personDetails?: Record<string, Record<string, unknown>>;
  metadataEditors?: Record<string, Record<string, unknown>>;
  extra?: (parsed: URL, url: string) => unknown | Promise<unknown> | undefined;
}

const createMockGetJson =
  (options: MockGetJsonOptions = {}) =>
  async (url: string) => {
    const parsed = new URL(url);
    const extraResult = await options.extra?.(parsed, url);
    if (extraResult !== undefined) {
      return extraResult;
    }

    if (parsed.pathname === "/System/Info/Public" && options.systemInfoPublic !== undefined) {
      return options.systemInfoPublic;
    }
    if (parsed.pathname === "/System/Endpoint" && options.systemEndpoint !== undefined) {
      return options.systemEndpoint;
    }
    if (parsed.pathname === "/Users/Query" && options.usersQuery !== undefined) {
      return options.usersQuery;
    }
    if (parsed.pathname === "/Persons") {
      const personTypes = parsed.searchParams.get("PersonTypes");
      if (personTypes === ACTOR_PERSON_TYPES_QUERY) {
        return { Items: options.filteredPersons ?? options.persons ?? [] };
      }
      if (options.persons !== undefined) {
        return { Items: options.persons };
      }
    }

    const personDetailPrefix = `/Users/${embyUserId}/Items/`;
    if (parsed.pathname.startsWith(personDetailPrefix)) {
      const personId = decodeURIComponent(parsed.pathname.slice(personDetailPrefix.length));
      const detail = options.personDetails?.[personId];
      if (detail !== undefined) {
        return detail;
      }
    }

    const metadataEditorMatch = parsed.pathname.match(/^\/Items\/([^/]+)\/MetadataEditor$/u);
    if (metadataEditorMatch) {
      const personId = decodeURIComponent(metadataEditorMatch[1]);
      const metadataEditor = options.metadataEditors?.[personId];
      if (metadataEditor !== undefined) {
        return metadataEditor;
      }
    }

    throw new Error(`Unexpected URL ${url}`);
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
    networkClient.getJson.mockImplementation(
      createMockGetJson({
        systemInfoPublic: { ServerName: "Emby", Version: "4.9.0.41" },
        systemEndpoint: { IsLocal: true, IsInNetwork: true },
        usersQuery: createAdminUsersQueryResponse(),
        persons: [{ Id: "person-1", Name: "神木麗", Overview: "" }],
        metadataEditors: { "person-1": {} },
      }),
    );

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

  it("uses the resolved Emby user id for people-read diagnostics", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(
      createMockGetJson({
        systemInfoPublic: { ServerName: "Emby", Version: "4.9.0.41" },
        systemEndpoint: { IsLocal: true, IsInNetwork: true },
        usersQuery: createAdminUsersQueryResponse(),
        persons: [{ Id: "person-1", Name: "神木麗", Overview: "" }],
        metadataEditors: { "person-1": {} },
        extra: (parsed) => {
          if (parsed.pathname === "/Persons" && !parsed.searchParams.get("userid")) {
            throw new Error(`HTTP 400 Bad Request for ${parsed.toString()}`);
          }
          return undefined;
        },
      }),
    );

    const result = await checkConnection(networkClient as unknown as NetworkClient, createEmbyConfig());

    expect(result.success).toBe(true);
    expect(
      networkClient.getJson.mock.calls.some(([url]) => {
        const parsed = new URL(url as string);
        return parsed.pathname === "/Persons" && parsed.searchParams.get("userid") === embyUserId;
      }),
    ).toBe(true);
  });

  it("updates actor info from the shared actor source provider", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(
      createMockGetJson({
        usersQuery: createAdminUsersQueryResponse(),
        persons: [{ Id: "person-1", Name: "神木麗" }],
        personDetails: {
          "person-1": {
            Id: "person-1",
            Name: "神木麗",
            Overview: "",
            DateCreated: "2026-01-01T00:00:00.0000000Z",
            ProviderIds: {},
            Type: "Person",
            LockedFields: [],
            LockData: false,
          },
        },
      }),
    );

    const actorSourceProvider = new FakeActorSourceProvider();
    actorSourceProvider.lookup.mockResolvedValue(createStructuredLookupResult());

    const service = createInfoService(networkClient, actorSourceProvider);

    const result = await service.run(createEmbyConfig(), "all");

    expect(result).toEqual({ processedCount: 1, failedCount: 0, skippedCount: 0 });
    expect(actorSourceProvider.lookup).toHaveBeenCalledWith(expect.any(Object), "神木麗");
    expect(networkClient.postText).toHaveBeenCalledTimes(2);
    expect(networkClient.postText.mock.calls[0]?.[0]).toContain("/Items/person-1?");
    expect(networkClient.postText.mock.calls[1]?.[0]).toContain("/Items/person-1/Refresh");
    expectStructuredActorPayload(
      readPostedPayload(networkClient),
      "基本资料\n血型：A型\n身高：169cm\n三围：B95 W60 H85\n罩杯：G杯\n\n官方简介\n\n别名：神木れい / かみきれい",
    );
    expect(readPostedPayload(networkClient)).toMatchObject({
      ProviderIds: {},
      Type: "Person",
      LockedFields: [],
      LockData: false,
    });
    expect(readPostedPayload(networkClient)).not.toHaveProperty("DateCreated");
    expect(
      networkClient.getJson.mock.calls.filter(([url]) => new URL(url as string).pathname === "/Users/Query"),
    ).toHaveLength(1);
    expect(
      networkClient.getJson.mock.calls.filter(([url]) => {
        const parsed = new URL(url as string);
        return parsed.pathname === "/Persons" && parsed.searchParams.get("PersonTypes") === ACTOR_PERSON_TYPES_QUERY;
      }),
    ).toHaveLength(1);
  });

  it("does not write sparse Emby detail fields back when the detail payload omits them", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(
      createMockGetJson({
        usersQuery: createAdminUsersQueryResponse(),
        persons: [{ Id: "person-1", Name: "神木麗" }],
        personDetails: {
          "person-1": {
            Id: "person-1",
            Name: "神木麗",
            Overview: "",
            Type: "Person",
          },
        },
      }),
    );

    const actorSourceProvider = new FakeActorSourceProvider();
    actorSourceProvider.lookup.mockResolvedValue(createStructuredLookupResult());

    const service = createInfoService(networkClient, actorSourceProvider);

    const result = await service.run(createEmbyConfig(), "all");

    expect(result).toEqual({ processedCount: 1, failedCount: 0, skippedCount: 0 });
    expect(readPostedPayload(networkClient)).not.toHaveProperty("ProviderIds");
    expect(readPostedPayload(networkClient)).not.toHaveProperty("LockedFields");
    expect(readPostedPayload(networkClient)).not.toHaveProperty("LockData");
  });

  it("fills missing actor native fields and summary in missing mode without overwriting the overview body", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(
      createMockGetJson({
        usersQuery: createAdminUsersQueryResponse(),
        persons: [{ Id: "person-1", Name: "神木麗" }],
        personDetails: {
          "person-1": { Id: "person-1", Name: "神木麗", Overview: "已有简介", Tags: ["favorite"], Taglines: [] },
        },
      }),
    );

    const actorSourceProvider = new FakeActorSourceProvider();
    actorSourceProvider.lookup.mockResolvedValue(createStructuredLookupResult());

    const service = createInfoService(networkClient, actorSourceProvider);

    const result = await service.run(createEmbyConfig(), "missing");

    expect(result).toEqual({ processedCount: 1, failedCount: 0, skippedCount: 0 });
    expectStructuredActorPayload(
      readPostedPayload(networkClient),
      "基本资料\n血型：A型\n身高：169cm\n三围：B95 W60 H85\n罩杯：G杯\n\n已有简介\n\n别名：神木れい / かみきれい",
      { tags: ["favorite"] },
    );
  });

  it("appends aliases to the existing overview in all mode when the source has no description", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(
      createMockGetJson({
        usersQuery: createAdminUsersQueryResponse(),
        persons: [{ Id: "person-1", Name: "神木麗" }],
        personDetails: {
          "person-1": { Id: "person-1", Name: "神木麗", Overview: "已有简介\n\n别名：旧别名" },
        },
      }),
    );

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

    expect(result).toEqual({ processedCount: 1, failedCount: 0, skippedCount: 0 });
    expect(readPostedPayload(networkClient)).toMatchObject({
      Overview: "已有简介\n\n别名：神木れい / かみきれい",
    });
  });

  it("preserves existing Emby production fields in the update payload", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(
      createMockGetJson({
        usersQuery: createAdminUsersQueryResponse(),
        persons: [{ Id: "person-1", Name: "神木麗" }],
        personDetails: {
          "person-1": {
            Id: "person-1",
            Name: "神木麗",
            Overview: "",
            PremiereDate: "1999-12-20T00:00:00.0000000Z",
            ProductionLocations: ["埼玉県"],
            ProductionYear: 1999,
          },
        },
      }),
    );

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
    networkClient.getJson.mockImplementation(
      createMockGetJson({
        usersQuery: createAdminUsersQueryResponse(),
        persons: [{ Id: "person-1", Name: "神木麗" }],
        personDetails: {
          "person-1": {
            Id: "person-1",
            Name: "神木麗",
            Overview:
              "基本资料\n血型：A型\n身高：169cm\n三围：B95 W60 H85\n罩杯：G杯\n\n已有简介\n\n别名：神木れい / かみきれい",
            Tags: ["favorite", "mdcz:birth_date:1999-12-20"],
            Taglines: ["精选", "MDCz: 1999-12-20"],
            PremiereDate: "1999-12-20T00:00:00.0000000Z",
            ProductionLocations: ["埼玉県"],
            ProductionYear: 1999,
          },
        },
      }),
    );

    const actorSourceProvider = new FakeActorSourceProvider();
    actorSourceProvider.lookup.mockResolvedValue(createStructuredLookupResult());

    const service = createInfoService(networkClient, actorSourceProvider);

    const result = await service.run(createEmbyConfig(), "missing");

    expect(result).toEqual({ processedCount: 1, failedCount: 0, skippedCount: 0 });
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
    networkClient.getJson.mockImplementation(
      createMockGetJson({
        persons: [{ Id: "person-1", Name: "神木麗", ImageTags: {} }],
      }),
    );
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
        emby: {
          userId: embyUserId,
        },
        personSync: {
          personImageSources: ["official"],
        },
      }),
      "all",
    );

    expect(result).toEqual({ processedCount: 1, failedCount: 0, skippedCount: 0 });
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

  it("auto-resolves the Emby user id before actor photo sync reads /Persons", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(
      createMockGetJson({
        usersQuery: createAdminUsersQueryResponse(),
        persons: [{ Id: "person-1", Name: "神木麗", ImageTags: {} }],
        extra: (parsed) => {
          if (parsed.pathname === "/Persons" && !parsed.searchParams.get("userid")) {
            throw new Error(`HTTP 400 Bad Request for ${parsed.toString()}`);
          }
          return undefined;
        },
      }),
    );
    networkClient.getContent.mockResolvedValue(new TextEncoder().encode("photo-bytes"));

    const actorSourceProvider = new FakeActorSourceProvider();
    actorSourceProvider.lookup.mockResolvedValue({
      profile: {
        name: "神木麗",
        photo_url: "https://images.example.com/actor-1.jpg",
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

    expect(result).toEqual({ processedCount: 1, failedCount: 0, skippedCount: 0 });
    expect(
      networkClient.getJson.mock.calls.some(([url]) => {
        const parsed = new URL(url as string);
        return parsed.pathname === "/Persons" && parsed.searchParams.get("userid") === embyUserId;
      }),
    ).toBe(true);
    expect(
      networkClient.getJson.mock.calls.filter(([url]) => new URL(url as string).pathname === "/Users/Query"),
    ).toHaveLength(1);
  });

  it("deduplicates repeated Emby person rows before syncing actor photos", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(
      createMockGetJson({
        persons: [
          { Id: "person-1", Name: "神木麗", ImageTags: {} },
          { Id: "person-1", Name: "神木麗", ImageTags: {} },
          { Id: "person-2", Name: "河北彩花", ImageTags: {} },
          { Id: "person-2", Name: "河北彩花", ImageTags: {} },
          { Id: "person-blank", Name: "   ", ImageTags: {} },
        ],
      }),
    );
    networkClient.getContent.mockImplementation(async (url: string) => new TextEncoder().encode(`photo:${url}`));

    const actorSourceProvider = new FakeActorSourceProvider();
    actorSourceProvider.lookup.mockImplementation(async (_configuration, query) => {
      const actorName = typeof query === "string" ? query : query.name;
      return {
        profile: {
          name: actorName,
          photo_url: `https://images.example.com/${encodeURIComponent(actorName)}.jpg`,
        },
        profileSources: {
          photo_url: "official",
        },
        sourceResults: [],
        warnings: [],
      };
    });

    const service = createPhotoService(networkClient, actorSourceProvider);

    const result = await service.run(
      createEmbyConfig({
        emby: {
          userId: embyUserId,
        },
        personSync: {
          personImageSources: ["official"],
        },
      }),
      "all",
    );

    expect(result).toEqual({ processedCount: 2, failedCount: 0, skippedCount: 0 });
    expect(actorSourceProvider.lookup).toHaveBeenCalledTimes(2);
    expect(networkClient.postText).toHaveBeenCalledTimes(4);
  });

  it("reads only the filtered actor list before syncing actor info", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(
      createMockGetJson({
        usersQuery: createAdminUsersQueryResponse(),
        persons: [{ Id: "person-1", Name: "神木麗" }],
        personDetails: {
          "person-1": {
            Id: "person-1",
            Name: "神木麗",
            Overview: "",
            Type: "Person",
            LockedFields: [],
            LockData: false,
          },
        },
      }),
    );

    const actorSourceProvider = new FakeActorSourceProvider();
    actorSourceProvider.lookup.mockResolvedValue(createStructuredLookupResult());

    const service = createInfoService(networkClient, actorSourceProvider);

    const result = await service.run(createEmbyConfig(), "all");

    expect(result).toEqual({ processedCount: 1, failedCount: 0, skippedCount: 0 });
    expect(
      networkClient.getJson.mock.calls.filter(([url]) => {
        const parsed = new URL(url as string);
        return parsed.pathname === "/Persons" && parsed.searchParams.get("PersonTypes") === ACTOR_PERSON_TYPES_QUERY;
      }),
    ).toHaveLength(1);
    expect(
      networkClient.getJson.mock.calls.some(([url]) => {
        const parsed = new URL(url as string);
        return parsed.pathname === "/Persons" && !parsed.searchParams.has("PersonTypes");
      }),
    ).toBe(false);
    expect(
      networkClient.getJson.mock.calls.some(
        ([url]) =>
          new URL(url as string).pathname === `/Users/${embyUserId}/Items` &&
          new URL(url as string).searchParams.has("PersonIds"),
      ),
    ).toBe(false);
  });

  it("filters out directors before syncing actor info", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(
      createMockGetJson({
        usersQuery: createAdminUsersQueryResponse(),
        persons: [
          { Id: "actor-1", Name: "神木麗" },
          { Id: "director-1", Name: "豆沢豆太郎" },
        ],
        filteredPersons: [{ Id: "actor-1", Name: "神木麗" }],
        personDetails: {
          "actor-1": {
            Id: "actor-1",
            Name: "神木麗",
            Overview: "",
            Type: "Person",
            LockedFields: [],
            LockData: false,
          },
        },
      }),
    );

    const actorSourceProvider = new FakeActorSourceProvider();
    actorSourceProvider.lookup.mockResolvedValue(createStructuredLookupResult());

    const service = createInfoService(networkClient, actorSourceProvider);

    const result = await service.run(createEmbyConfig(), "all");

    expect(result).toEqual({ processedCount: 1, failedCount: 0, skippedCount: 0 });
    expect(actorSourceProvider.lookup).toHaveBeenCalledTimes(1);
    expect(actorSourceProvider.lookup).toHaveBeenCalledWith(expect.any(Object), "神木麗");
    expect(networkClient.postText).toHaveBeenCalledTimes(2);
  });

  it("treats an empty filtered actor list as no actors without fallback lookups", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(
      createMockGetJson({
        usersQuery: createAdminUsersQueryResponse(),
        persons: [{ Id: "director-1", Name: "豆沢豆太郎" }],
        filteredPersons: [],
      }),
    );

    const actorSourceProvider = new FakeActorSourceProvider();
    const service = createInfoService(networkClient, actorSourceProvider);

    const result = await service.run(createEmbyConfig(), "all");

    expect(result).toEqual({ processedCount: 0, failedCount: 0, skippedCount: 0 });
    expect(actorSourceProvider.lookup).not.toHaveBeenCalled();
    expect(networkClient.postText).not.toHaveBeenCalled();
    expect(
      networkClient.getJson.mock.calls.filter(([url]) => {
        const parsed = new URL(url as string);
        return parsed.pathname === "/Persons" && parsed.searchParams.get("PersonTypes") === ACTOR_PERSON_TYPES_QUERY;
      }),
    ).toHaveLength(1);
    expect(
      networkClient.getJson.mock.calls.some(([url]) => {
        const parsed = new URL(url as string);
        return parsed.pathname === "/Persons" && !parsed.searchParams.has("PersonTypes");
      }),
    ).toBe(false);
    expect(
      networkClient.getJson.mock.calls.some(
        ([url]) =>
          new URL(url as string).pathname === `/Users/${embyUserId}/Items` &&
          new URL(url as string).searchParams.has("PersonIds"),
      ),
    ).toBe(false);
  });

  it("filters out directors before syncing actor photos", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(
      createMockGetJson({
        usersQuery: createAdminUsersQueryResponse(),
        persons: [
          { Id: "actor-1", Name: "神木麗", ImageTags: {} },
          { Id: "director-1", Name: "豆沢豆太郎", ImageTags: {} },
        ],
        filteredPersons: [{ Id: "actor-1", Name: "神木麗", ImageTags: {} }],
      }),
    );
    networkClient.getContent.mockResolvedValue(new TextEncoder().encode("photo-bytes"));

    const actorSourceProvider = new FakeActorSourceProvider();
    actorSourceProvider.lookup.mockResolvedValue({
      profile: {
        name: "神木麗",
        photo_url: "https://images.example.com/actor-1.jpg",
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

    expect(result).toEqual({ processedCount: 1, failedCount: 0, skippedCount: 0 });
    expect(actorSourceProvider.lookup).toHaveBeenCalledTimes(1);
    expect(actorSourceProvider.lookup).toHaveBeenCalledWith(expect.any(Object), {
      name: "神木麗",
      requiredField: "photo_url",
    });
    expect(networkClient.postText).toHaveBeenCalledTimes(2);
  });
});
