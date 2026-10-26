import type { ActorLookupResult, ActorSourceProvider } from "@mdcz/runtime/actorSource";
import {
  checkEmbyConnection as checkConnection,
  type MediaServerActorServiceDependencies,
  type MediaServerSignalService,
  syncEmbyPersons,
} from "@mdcz/runtime/mediaserver";
import type { NetworkClient } from "@mdcz/runtime/network";
import { configurationSchema, defaultConfiguration } from "@mdcz/shared/config";
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

const signalService: MediaServerSignalService = {
  resetProgress: vi.fn(),
  setProgress: vi.fn(),
  showLogText: vi.fn(),
};

const createDeps = (
  networkClient: FakeNetworkClient,
  actorSourceProvider: FakeActorSourceProvider,
): MediaServerActorServiceDependencies => ({
  signalService,
  networkClient: networkClient as unknown as NetworkClient,
  actorSourceProvider: actorSourceProvider as unknown as ActorSourceProvider,
  logger: { debug() {}, info() {}, warn() {}, error() {} },
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

const createAdminUsersResponse = () => [{ Id: embyUserId, Policy: { IsAdministrator: true, EnableAllFolders: true } }];

interface MockGetJsonOptions {
  systemInfoPublic?: Record<string, unknown>;
  systemEndpoint?: Record<string, unknown>;
  users?: unknown[];
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

    if (parsed.pathname === "/System/Info/Public") {
      return options.systemInfoPublic ?? { ServerName: "Emby", Version: "4.10.1.0" };
    }
    if (parsed.pathname === "/System/Endpoint" && options.systemEndpoint !== undefined) {
      return options.systemEndpoint;
    }
    if (parsed.pathname === "/Users" && options.users !== undefined) {
      return options.users;
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
  it("returns layered diagnostics with an admin-key notice step for a healthy Emby connection", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(
      createMockGetJson({
        systemInfoPublic: { ServerName: "Emby", Version: "4.9.0.41" },
        systemEndpoint: { IsLocal: true, IsInNetwork: true },
        users: createAdminUsersResponse(),
        persons: [{ Id: "person-1", Name: "神木麗", Overview: "" }],
        metadataEditors: { "person-1": {} },
      }),
    );

    const result = await checkConnection(networkClient as unknown as NetworkClient, createEmbyConfig());

    expect(result.success).toBe(true);
    expect(result.serverInfo).toEqual({ serverName: "Emby", version: "4.9.0.41" });
    expect(result.steps).toEqual([
      { key: "server", status: "ok" },
      { key: "auth", status: "ok" },
      { key: "peopleRead", status: "ok" },
      { key: "peopleWrite", status: "ok" },
      { key: "adminKey", status: "skipped" },
    ]);
  });

  it("reads people for diagnostics exactly as the sync does: resolved user id and actor filter", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(
      createMockGetJson({
        systemInfoPublic: { ServerName: "Emby", Version: "4.9.0.41" },
        systemEndpoint: { IsLocal: true, IsInNetwork: true },
        users: createAdminUsersResponse(),
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
        return (
          parsed.pathname === "/Persons" &&
          parsed.searchParams.get("userid") === embyUserId &&
          parsed.searchParams.get("PersonTypes") === ACTOR_PERSON_TYPES_QUERY
        );
      }),
    ).toBe(true);
  });

  it("writes the whole person back with only the synced fields replaced", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(
      createMockGetJson({
        users: createAdminUsersResponse(),
        persons: [{ Id: "person-1", Name: "神木麗" }],
        personDetails: {
          "person-1": {
            Id: "person-1",
            Name: "神木麗",
            SortName: "かみき れい",
            OriginalTitle: "Rei Kamiki",
            Overview: "",
            DateCreated: "2026-01-01T00:00:00.0000000Z",
            Genres: [],
            ProviderIds: {},
            Type: "Person",
            LockedFields: [],
            LockData: false,
            Tags: [],
            TagItems: [
              { Name: "favorite", Id: "tag-1" },
              { Name: "mdcz:legacy", Id: "tag-2" },
            ],
          },
        },
      }),
    );

    const actorSourceProvider = new FakeActorSourceProvider();
    actorSourceProvider.lookup.mockResolvedValue(createStructuredLookupResult());

    const deps = createDeps(networkClient, actorSourceProvider);

    const result = await syncEmbyPersons(deps, createEmbyConfig(), "info", "all");

    expect(result).toEqual({ processedCount: 1, failedCount: 0, skippedCount: 0 });
    expect(actorSourceProvider.lookup).toHaveBeenCalledWith(expect.any(Object), "神木麗");
    expect(networkClient.postText).toHaveBeenCalledTimes(1);
    expect(networkClient.postText.mock.calls[0]?.[0]).toMatch(/\/Items\/person-1$/u);
    const payload = readPostedPayload(networkClient);
    expectStructuredActorPayload(
      payload,
      "基本资料\n血型：A型\n身高：169cm\n三围：B95 W60 H85\n罩杯：G杯\n\n官方简介\n\n别名：神木れい / かみきれい",
      { tags: ["favorite"] },
    );
    expect(payload).toMatchObject({
      Id: "person-1",
      Name: "神木麗",
      SortName: "かみき れい",
      OriginalTitle: "Rei Kamiki",
      DateCreated: "2026-01-01T00:00:00.0000000Z",
      Genres: [],
      ProviderIds: {},
      Type: "Person",
      LockedFields: [],
      LockData: false,
    });
    expect(payload).not.toHaveProperty("TagItems");
    expect(
      networkClient.getJson.mock.calls.filter(([url]) => new URL(url as string).pathname === "/Users"),
    ).toHaveLength(1);
    expect(
      networkClient.getJson.mock.calls.filter(([url]) => new URL(url as string).pathname === "/Persons"),
    ).toHaveLength(1);
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

    const deps = createDeps(networkClient, actorSourceProvider);

    const result = await syncEmbyPersons(
      deps,
      createEmbyConfig({
        emby: {
          userId: embyUserId,
        },
        personSync: {
          personImageSources: ["official"],
        },
      }),
      "photo",
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
    expect(networkClient.postText).toHaveBeenCalledTimes(1);
    expect(networkClient.postText.mock.calls[0]?.[0]).toMatch(/\/Items\/person-1\/Images\/Primary$/u);
  });

  it("auto-resolves the Emby user id before actor photo sync reads /Persons", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(
      createMockGetJson({
        users: createAdminUsersResponse(),
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

    const deps = createDeps(networkClient, actorSourceProvider);

    const result = await syncEmbyPersons(
      deps,
      createEmbyConfig({
        personSync: {
          personImageSources: ["official"],
        },
      }),
      "photo",
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
      networkClient.getJson.mock.calls.filter(([url]) => new URL(url as string).pathname === "/Users"),
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

    const deps = createDeps(networkClient, actorSourceProvider);

    const result = await syncEmbyPersons(
      deps,
      createEmbyConfig({
        emby: {
          userId: embyUserId,
        },
        personSync: {
          personImageSources: ["official"],
        },
      }),
      "photo",
      "all",
    );

    expect(result).toEqual({ processedCount: 2, failedCount: 0, skippedCount: 0 });
    expect(actorSourceProvider.lookup).toHaveBeenCalledTimes(2);
    expect(networkClient.postText).toHaveBeenCalledTimes(2);
  });

  it.each([
    { version: "4.5.4.0", personTypes: null, lookedUp: ["神木麗", "豆沢豆太郎"] },
    { version: "4.8.11.0", personTypes: ACTOR_PERSON_TYPES_QUERY, lookedUp: ["神木麗"] },
  ])("lists people through the actor filter only where Emby $version honours it", async ({
    version,
    personTypes,
    lookedUp,
  }) => {
    const networkClient = new FakeNetworkClient();
    const detail = (Id: string, Name: string) => ({ Id, Name, Overview: "", Genres: [], ProviderIds: {}, Tags: [] });
    networkClient.getJson.mockImplementation(
      createMockGetJson({
        systemInfoPublic: { ServerName: "Emby", Version: version },
        users: createAdminUsersResponse(),
        persons: [
          { Id: "actor-1", Name: "神木麗" },
          { Id: "director-1", Name: "豆沢豆太郎" },
        ],
        filteredPersons: [{ Id: "actor-1", Name: "神木麗" }],
        personDetails: { "actor-1": detail("actor-1", "神木麗"), "director-1": detail("director-1", "豆沢豆太郎") },
      }),
    );

    const actorSourceProvider = new FakeActorSourceProvider();
    actorSourceProvider.lookup.mockResolvedValue(createStructuredLookupResult());

    const deps = createDeps(networkClient, actorSourceProvider);

    const result = await syncEmbyPersons(deps, createEmbyConfig(), "info", "all");

    expect(result).toEqual({ processedCount: lookedUp.length, failedCount: 0, skippedCount: 0 });
    expect(actorSourceProvider.lookup.mock.calls.map(([, query]) => query).sort()).toEqual([...lookedUp].sort());
    expect(
      networkClient.getJson.mock.calls
        .map(([url]) => new URL(url as string))
        .filter((url) => url.pathname === "/Persons")
        .map((url) => url.searchParams.get("PersonTypes")),
    ).toEqual([personTypes]);
  });

  it("treats an empty filtered actor list as no actors without fallback lookups", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(
      createMockGetJson({
        users: createAdminUsersResponse(),
        persons: [{ Id: "director-1", Name: "豆沢豆太郎" }],
        filteredPersons: [],
      }),
    );

    const actorSourceProvider = new FakeActorSourceProvider();
    const deps = createDeps(networkClient, actorSourceProvider);

    const result = await syncEmbyPersons(deps, createEmbyConfig(), "info", "all");

    expect(result).toEqual({ processedCount: 0, failedCount: 0, skippedCount: 0 });
    expect(signalService.showLogText).toHaveBeenCalledWith("Emby returned no actors to sync", "warn");
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
});
