import type { Configuration } from "@mdcz/shared/config";
import type { MediaServerConnectionCheckResult, PersonSyncResult } from "@mdcz/shared/toolTypes";
import type { RuntimeNetworkClient } from "../network";
import {
  buildMediaServerHeaders,
  buildMediaServerUrl,
  deleteMediaServerPrimaryImage,
  fetchMediaServerMetadataEditorInfo,
  fetchMediaServerPersons,
  fetchMediaServerResolvedUserId,
  fetchMediaServerUserScopedItemDetail,
  type MediaServerHeadersInit,
  type MediaServerItemDetail,
  type MediaServerMode,
  updateMediaServerItem,
  uploadMediaServerPrimaryImage,
} from "./client";
import {
  isRecord,
  pickAutoResolvedUserId,
  toBooleanValue,
  toStringArray,
  toStringRecord,
  toStringValue,
} from "./common";
import { runMediaServerConnectionCheck } from "./connectionCheck";
import { type MediaServerErrorMapping, MediaServerServiceError, toMediaServerServiceError } from "./errors";
import {
  findPersonNamed,
  type MediaServerActorServiceDependencies,
  type MediaServerPerson,
  type MediaServerPersonTarget,
  type PersonSyncKind,
  runMediaServerPersonSync,
} from "./personSync";
import type { PlannedPersonSyncState } from "./planner";

export type JellyfinPerson = MediaServerPerson;

export class JellyfinServiceError extends MediaServerServiceError {}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const isJellyfinUuid = (value: string): boolean => UUID_PATTERN.test(value.trim());

export const toJellyfinServiceError = (
  error: unknown,
  statusMappings: Partial<Record<number, MediaServerErrorMapping>>,
  fallback: MediaServerErrorMapping,
): JellyfinServiceError => toMediaServerServiceError(error, JellyfinServiceError, statusMappings, fallback);

export const buildJellyfinUrl = (
  configuration: Configuration,
  path: string,
  query: Record<string, string | undefined> = {},
): string => buildMediaServerUrl(configuration, "jellyfin", path, query);

export const buildJellyfinHeaders = (configuration: Configuration, headers: MediaServerHeadersInit = {}): Headers =>
  buildMediaServerHeaders(configuration, "jellyfin", headers);

const getConfiguredJellyfinUserId = (configuration: Configuration): string | undefined => {
  const trimmedUserId = configuration.jellyfin.userId.trim();
  if (trimmedUserId && !isJellyfinUuid(trimmedUserId)) {
    throw new JellyfinServiceError("JELLYFIN_INVALID_USER_ID", "Jellyfin userId must be a UUID");
  }
  return trimmedUserId || undefined;
};

const fetchAutoResolvedJellyfinUserId = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
): Promise<string> =>
  await fetchMediaServerResolvedUserId(
    {
      networkClient,
      configuration,
      serverKey: "jellyfin",
      path: "/Users",
      extractUsers: (response) => (Array.isArray(response) ? response : []),
      pickUserId: (users) => pickAutoResolvedUserId(users),
      createMissingUserContextError: () =>
        new JellyfinServiceError(
          "JELLYFIN_USER_CONTEXT_REQUIRED",
          "Current Jellyfin server requires user context; please configure Jellyfin user ID in settings and retry",
        ),
      toServiceError: toJellyfinServiceError,
    },
    {
      statusMappings: {
        401: { code: "JELLYFIN_AUTH_FAILED", message: "Jellyfin API key is invalid; cannot read user list" },
        403: {
          code: "JELLYFIN_PERMISSION_DENIED",
          message: "Current Jellyfin credentials lack permission to read user list",
        },
      },
      fallback: {
        code: "JELLYFIN_USER_CONTEXT_REQUIRED",
        message:
          "Current Jellyfin server requires user context; please configure Jellyfin user ID in settings and retry",
      },
    },
  );

export const resolveJellyfinUserId = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
): Promise<string> =>
  getConfiguredJellyfinUserId(configuration) ?? (await fetchAutoResolvedJellyfinUserId(networkClient, configuration));

export const buildJellyfinPersonUpdatePayload = (
  person: JellyfinPerson,
  detail: MediaServerItemDetail,
  synced: PlannedPersonSyncState,
  lockOverview: boolean,
): Record<string, unknown> => {
  const genres = toStringArray(detail.Genres);
  const providerIds = toStringRecord(detail.ProviderIds);
  const lockedFields = Array.from(new Set(toStringArray(detail.LockedFields)));

  const payload: Record<string, unknown> = {
    Id: person.Id,
    Name: toStringValue(detail.Name) ?? person.Name,
    Overview: synced.overview ?? toStringValue(detail.Overview) ?? "",
    Genres: genres,
    Tags: synced.tags,
    ProviderIds: providerIds,
    Taglines: synced.taglines,
    ProductionLocations: synced.productionLocations ?? [],
  };

  const serverId = toStringValue(detail.ServerId);
  if (serverId) payload.ServerId = serverId;
  const type = toStringValue(detail.Type);
  if (type) payload.Type = type;
  const personType = toStringValue(detail.PersonType);
  if (personType) payload.PersonType = personType;
  if (synced.premiereDate) payload.PremiereDate = synced.premiereDate;
  if (synced.productionYear !== undefined) payload.ProductionYear = synced.productionYear;

  if (lockOverview && !lockedFields.includes("Overview")) {
    lockedFields.push("Overview");
  }
  payload.LockedFields = lockedFields;

  const lockData = toBooleanValue(detail.LockData);
  payload.LockData = lockOverview ? true : (lockData ?? false);

  return payload;
};

export const fetchJellyfinPersons = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
  options: {
    limit?: number;
    fields?: string[];
    userId?: string;
    searchTerm?: string;
  } = {},
): Promise<JellyfinPerson[]> => {
  const userId = options.userId ?? getConfiguredJellyfinUserId(configuration);

  return await fetchMediaServerPersons(
    {
      networkClient,
      configuration,
      serverKey: "jellyfin",
      query: {
        userId,
        personTypes: "Actor",
        searchTerm: options.searchTerm,
        Limit: options.limit !== undefined ? String(options.limit) : undefined,
        Fields: options.fields?.join(","),
      },
      extractItems: (response) => {
        if (!isRecord(response) || !Array.isArray(response.Items)) {
          return [];
        }
        return response.Items;
      },
      parsePerson: (item) => {
        if (!isRecord(item)) return null;
        const id = toStringValue(item.Id);
        const name = toStringValue(item.Name);
        if (!id || !name) return null;
        return {
          Id: id,
          Name: name,
          Overview: toStringValue(item.Overview),
          ImageTags: isRecord(item.ImageTags) ? toStringRecord(item.ImageTags) : undefined,
        };
      },
      toServiceError: toJellyfinServiceError,
    },
    {
      statusMappings: {
        400: { code: "JELLYFIN_BAD_REQUEST", message: "Invalid Jellyfin person request parameters" },
        401: { code: "JELLYFIN_AUTH_FAILED", message: "Jellyfin API key is invalid or expired" },
        403: {
          code: "JELLYFIN_PERMISSION_DENIED",
          message: "Current Jellyfin credentials lack person read permissions",
        },
      },
      fallback: {
        code: "JELLYFIN_UNREACHABLE",
        message: "Failed to read Jellyfin person list",
      },
    },
  );
};

export const fetchJellyfinPersonDetail = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
  person: JellyfinPerson,
  options: { userId?: string } = {},
): Promise<MediaServerItemDetail> => {
  const userId = options.userId ?? (await resolveJellyfinUserId(networkClient, configuration));

  return await fetchMediaServerUserScopedItemDetail(
    {
      networkClient,
      configuration,
      serverKey: "jellyfin",
      personId: person.Id,
      userId,
      createMissingUserContextError: () =>
        new JellyfinServiceError(
          "JELLYFIN_USER_CONTEXT_REQUIRED",
          "Current Jellyfin server requires user context; please configure Jellyfin user ID in settings and retry",
        ),
      toServiceError: toJellyfinServiceError,
    },
    {
      statusMappings: {
        401: {
          code: "JELLYFIN_AUTH_FAILED",
          message: `Failed to read person details: Jellyfin API key is invalid; cannot access ${person.Name}`,
        },
        403: {
          code: "JELLYFIN_PERMISSION_DENIED",
          message: `Failed to read person details: current Jellyfin API key has no permission to access ${person.Name}`,
        },
        404: { code: "JELLYFIN_NOT_FOUND", message: `Person ${person.Name} does not exist in Jellyfin` },
      },
      fallback: {
        code: "JELLYFIN_UNREACHABLE",
        message: `Failed to read Jellyfin person details: ${person.Name}`,
      },
    },
  );
};

export const fetchJellyfinMetadataEditorInfo = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
  personId: string,
): Promise<Record<string, unknown>> =>
  await fetchMediaServerMetadataEditorInfo(
    {
      networkClient,
      configuration,
      serverKey: "jellyfin",
      personId,
      toServiceError: toJellyfinServiceError,
    },
    {
      statusMappings: {
        401: {
          code: "JELLYFIN_AUTH_FAILED",
          message: "Jellyfin credentials are invalid; cannot verify person write permissions",
        },
        403: {
          code: "JELLYFIN_PERMISSION_DENIED",
          message: "Current Jellyfin credentials lack person write permissions",
        },
        404: { code: "JELLYFIN_NOT_FOUND", message: "Jellyfin cannot retrieve metadata editor info for person" },
      },
      fallback: {
        code: "JELLYFIN_UNREACHABLE",
        message: "Failed to read Jellyfin metadata editor info for person",
      },
    },
  );

export const deleteJellyfinPrimaryImage = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
  personId: string,
): Promise<void> => {
  await deleteMediaServerPrimaryImage(
    {
      networkClient,
      configuration,
      serverKey: "jellyfin",
      personId,
      toServiceError: toJellyfinServiceError,
    },
    {
      statusMappings: {
        401: { code: "JELLYFIN_AUTH_FAILED", message: "Jellyfin credentials are invalid; cannot remove person photo" },
        403: {
          code: "JELLYFIN_PERMISSION_DENIED",
          message: "Current Jellyfin credentials lack person photo write permissions",
        },
      },
      fallback: {
        code: "JELLYFIN_WRITE_FAILED",
        message: "Failed to remove Jellyfin person photo",
      },
    },
  );
};

export const updateJellyfinPersonInfo = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
  person: JellyfinPerson,
  detail: MediaServerItemDetail,
  synced: PlannedPersonSyncState,
  options: { lockOverview?: boolean } = {},
): Promise<void> => {
  const payload = buildJellyfinPersonUpdatePayload(person, detail, synced, options.lockOverview ?? false);
  await updateMediaServerItem(
    {
      networkClient,
      configuration,
      serverKey: "jellyfin",
      personId: person.Id,
      payload,
      toServiceError: toJellyfinServiceError,
    },
    {
      statusMappings: {
        400: { code: "JELLYFIN_BAD_REQUEST", message: `Jellyfin rejected person update: ${person.Name}` },
        401: { code: "JELLYFIN_AUTH_FAILED", message: "Jellyfin credentials are invalid; cannot write person info" },
        403: {
          code: "JELLYFIN_PERMISSION_DENIED",
          message: "Current Jellyfin credentials lack person write permissions",
        },
        404: { code: "JELLYFIN_NOT_FOUND", message: `Person ${person.Name} does not exist in Jellyfin` },
      },
      fallback: {
        code: "JELLYFIN_WRITE_FAILED",
        message: `Failed to write Jellyfin person info: ${person.Name}`,
      },
    },
  );
};

export const uploadJellyfinPrimaryImage = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
  personId: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> => {
  const primaryPath = `/Items/${encodeURIComponent(personId)}/Images/Primary`;
  await uploadMediaServerPrimaryImage(
    {
      networkClient,
      configuration,
      serverKey: "jellyfin",
      personId,
      bytes,
      contentType,
      retryableStatuses: [404, 405],
      fallbackPath: `${primaryPath}/0`,
      toServiceError: toJellyfinServiceError,
    },
    {
      statusMappings: {
        400: { code: "JELLYFIN_BAD_REQUEST", message: "Jellyfin rejected person photo upload request" },
        401: { code: "JELLYFIN_AUTH_FAILED", message: "Jellyfin credentials are invalid; cannot upload person photo" },
        403: {
          code: "JELLYFIN_PERMISSION_DENIED",
          message: "Current Jellyfin credentials lack person photo write permissions",
        },
        415: { code: "JELLYFIN_UNSUPPORTED_MEDIA", message: "Jellyfin does not accept the current photo file type" },
      },
      fallback: {
        code: "JELLYFIN_WRITE_FAILED",
        message: "Failed to upload Jellyfin person photo",
      },
    },
  );
};

interface PublicSystemInfo {
  ServerName?: string;
  Version?: string;
}

// Jellyfin searches these providers by bare name for every person its scan creates, which matches JAV actors to
// unrelated people. It has no per-library switch for people; only the server-wide Person metadata options work.
const PERSON_NAME_SEARCH_PROVIDERS = ["TheMovieDb", "The Open Movie Database"];

interface JellyfinMetadataOptions {
  ItemType: string;
  DisabledMetadataFetchers?: string[];
  DisabledImageFetchers?: string[];
}

type JellyfinServerConfiguration = Record<string, unknown> & { MetadataOptions?: JellyfinMetadataOptions[] };

const fetchJellyfinServerConfiguration = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
): Promise<JellyfinServerConfiguration> =>
  await networkClient.getJson<JellyfinServerConfiguration>(buildJellyfinUrl(configuration, "/System/Configuration"), {
    headers: buildJellyfinHeaders(configuration, { accept: "application/json" }),
  });

const findPersonMetadataOptions = (serverConfiguration: JellyfinServerConfiguration) =>
  serverConfiguration.MetadataOptions?.find((options) => options.ItemType === "Person");

/** Turns off the name searches for people on the whole server, so new actors keep only what MDCz writes. */
export const stopJellyfinPersonNameMatching = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
): Promise<void> => {
  const serverConfiguration = await fetchJellyfinServerConfiguration(networkClient, configuration);
  const current = findPersonMetadataOptions(serverConfiguration);
  const disable = (names: string[] = []) => [...new Set([...names, ...PERSON_NAME_SEARCH_PROVIDERS])];
  const person = {
    MetadataFetcherOrder: [],
    ImageFetcherOrder: [],
    DisabledMetadataSavers: [],
    LocalMetadataReaderOrder: [],
    ...current,
    ItemType: "Person",
    DisabledMetadataFetchers: disable(current?.DisabledMetadataFetchers),
    DisabledImageFetchers: disable(current?.DisabledImageFetchers),
  };
  const metadataOptions = (serverConfiguration.MetadataOptions ?? []).filter((options) => options !== current);
  await networkClient.postText(
    buildJellyfinUrl(configuration, "/System/Configuration"),
    JSON.stringify({ ...serverConfiguration, MetadataOptions: [...metadataOptions, person] }),
    { headers: buildJellyfinHeaders(configuration, { "content-type": "application/json" }) },
  );
};

export const checkJellyfinConnection = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
): Promise<MediaServerConnectionCheckResult> => {
  const result = await runMediaServerConnectionCheck({
    includeAdminKeyStep: false,
    unreachableCode: "JELLYFIN_UNREACHABLE",
    authFailedCode: "JELLYFIN_AUTH_FAILED",
    fetchPublicServerInfo: async () => {
      const info = await networkClient.getJson<PublicSystemInfo>(
        buildJellyfinUrl(configuration, "/System/Info/Public"),
        {
          headers: { accept: "application/json" },
        },
      );
      return {
        serverName: typeof info.ServerName === "string" ? info.ServerName : undefined,
        version: typeof info.Version === "string" ? info.Version : undefined,
      };
    },
    verifyAuth: async () => {
      await networkClient.getJson<Record<string, unknown>>(buildJellyfinUrl(configuration, "/System/Info"), {
        headers: buildJellyfinHeaders(configuration, { accept: "application/json" }),
      });
    },
    fetchPersons: async () =>
      await fetchJellyfinPersons(networkClient, configuration, {
        limit: 1,
        fields: ["Overview"],
      }),
    getPersonId: (person) => person.Id,
    verifyWritePermission: async (personId) => {
      await fetchJellyfinMetadataEditorInfo(networkClient, configuration, personId);
    },
  });
  if (!result.success) return result;
  // The connection works either way; when the server configuration can't be read, its name search stays unknown.
  const serverConfiguration = await fetchJellyfinServerConfiguration(networkClient, configuration).catch(() => null);
  if (!serverConfiguration) return result;
  const person = findPersonMetadataOptions(serverConfiguration);
  const matchesPeopleByName = PERSON_NAME_SEARCH_PROVIDERS.some(
    (name) => !person?.DisabledMetadataFetchers?.includes(name) || !person.DisabledImageFetchers?.includes(name),
  );
  return { ...result, matchesPeopleByName };
};

/**
 * The user ID is resolved on the first detail read, so photo-only syncs never ask the server for its users; a failed
 * resolve is retried on the next read instead of failing every later one.
 */
export const createJellyfinPersonTarget = (
  deps: MediaServerActorServiceDependencies,
  configuration: Configuration,
  userId?: string,
): MediaServerPersonTarget<JellyfinPerson> => {
  let resolvedUserId: Promise<string> | undefined;
  return {
    ...deps,
    serviceName: "Jellyfin",
    configuration,
    findPerson: async (name) =>
      findPersonNamed(
        await fetchJellyfinPersons(deps.networkClient, configuration, {
          searchTerm: name,
        }),
        name,
      ),
    fetchPersonDetail: async (person) => {
      resolvedUserId ??= userId
        ? Promise.resolve(userId)
        : resolveJellyfinUserId(deps.networkClient, configuration).catch((error: unknown) => {
            resolvedUserId = undefined;
            throw error;
          });
      return await fetchJellyfinPersonDetail(deps.networkClient, configuration, person, {
        userId: await resolvedUserId,
      });
    },
    updatePersonInfo: async (person, detail, synced) =>
      await updateJellyfinPersonInfo(deps.networkClient, configuration, person, detail, synced, {
        lockOverview: configuration.jellyfin.lockOverviewAfterSync,
      }),
    uploadPrimaryImage: async (personId, bytes, contentType) =>
      await uploadJellyfinPrimaryImage(deps.networkClient, configuration, personId, bytes, contentType),
    deletePrimaryImage: async (personId) =>
      await deleteJellyfinPrimaryImage(deps.networkClient, configuration, personId),
  };
};

export const syncJellyfinPersons = async (
  deps: MediaServerActorServiceDependencies,
  configuration: Configuration,
  kind: PersonSyncKind,
  mode: MediaServerMode,
): Promise<PersonSyncResult> => {
  if (kind === "photo") {
    return await runMediaServerPersonSync(
      createJellyfinPersonTarget(deps, configuration),
      { photo: mode },
      await fetchJellyfinPersons(deps.networkClient, configuration),
    );
  }
  const userId = await resolveJellyfinUserId(deps.networkClient, configuration);
  return await runMediaServerPersonSync(
    createJellyfinPersonTarget(deps, configuration, userId),
    { info: mode },
    await fetchJellyfinPersons(deps.networkClient, configuration, { fields: ["Overview"], userId }),
  );
};
