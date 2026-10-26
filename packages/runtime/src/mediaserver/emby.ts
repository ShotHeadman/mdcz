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
  normalizeMediaServerPersons,
  updateMediaServerItem,
  uploadMediaServerPrimaryImage,
} from "./client";
import { isRecord, isString, pickAutoResolvedUserId, toStringArray, toStringRecord, toStringValue } from "./common";
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

export type EmbyPerson = MediaServerPerson;

export class EmbyServiceError extends MediaServerServiceError {}

export const toEmbyServiceError = (
  error: unknown,
  statusMappings: Partial<Record<number, MediaServerErrorMapping>>,
  fallback: MediaServerErrorMapping,
): EmbyServiceError => toMediaServerServiceError(error, EmbyServiceError, statusMappings, fallback);

export const buildEmbyUrl = (
  configuration: Configuration,
  path: string,
  query: Record<string, string | undefined> = {},
): string => buildMediaServerUrl(configuration, "emby", path, query);

export const buildEmbyHeaders = (configuration: Configuration, headers: MediaServerHeadersInit = {}): Headers =>
  buildMediaServerHeaders(configuration, "emby", headers);

const ACTOR_PERSON_TYPES = ["Actor", "GuestStar"] as const;

interface PublicSystemInfo {
  ServerName?: string;
  Version?: string;
}

interface EmbyPersonQuery {
  userId: string;
  personTypes?: string[];
}

const fetchAutoResolvedEmbyUserId = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
): Promise<string> =>
  await fetchMediaServerResolvedUserId(
    {
      networkClient,
      configuration,
      serverKey: "emby",
      path: "/Users",
      extractUsers: (response) => (Array.isArray(response) ? response : []),
      pickUserId: (users) => pickAutoResolvedUserId(users),
      createMissingUserContextError: () =>
        new EmbyServiceError(
          "EMBY_USER_CONTEXT_REQUIRED",
          "Current Emby server requires user context; please configure Emby user ID in settings and retry",
        ),
      toServiceError: toEmbyServiceError,
    },
    {
      statusMappings: {
        401: { code: "EMBY_AUTH_FAILED", message: "Emby API key is invalid; cannot read user list" },
        403: { code: "EMBY_PERMISSION_DENIED", message: "Current Emby credentials lack permission to read user list" },
      },
      fallback: {
        code: "EMBY_USER_CONTEXT_REQUIRED",
        message: "Current Emby server requires user context; please configure Emby user ID in settings and retry",
      },
    },
  );

const fetchEmbyPublicSystemInfo = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
): Promise<PublicSystemInfo> => {
  try {
    return await networkClient.getJson<PublicSystemInfo>(buildEmbyUrl(configuration, "/System/Info/Public"), {
      headers: { accept: "application/json" },
    });
  } catch (error) {
    throw toEmbyServiceError(error, {}, { code: "EMBY_UNREACHABLE", message: "Failed to read Emby server info" });
  }
};

const resolveEmbyPersonQuery = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
): Promise<EmbyPersonQuery> => {
  const [userId, { Version }] = await Promise.all([
    configuration.emby.userId.trim() || fetchAutoResolvedEmbyUserId(networkClient, configuration),
    fetchEmbyPublicSystemInfo(networkClient, configuration),
  ]);
  // Emby 4.5 returns nobody for any PersonTypes filter, and 4.8 is the oldest seen filtering correctly, so older
  // servers list every person, directors included.
  const ignoresPersonTypes = typeof Version === "string" && Version.localeCompare("4.8", "en", { numeric: true }) < 0;
  return { userId, personTypes: ignoresPersonTypes ? undefined : [...ACTOR_PERSON_TYPES] };
};

export const fetchEmbyPersons = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
  options: EmbyPersonQuery & { limit?: number; fields?: string[]; searchTerm?: string },
): Promise<EmbyPerson[]> =>
  await fetchMediaServerPersons(
    {
      networkClient,
      configuration,
      serverKey: "emby",
      query: {
        userid: options.userId,
        Limit: options.limit !== undefined ? String(options.limit) : undefined,
        Fields: options.fields?.join(","),
        PersonTypes: options.personTypes?.join(","),
        SearchTerm: options.searchTerm,
      },
      extractItems: (response) => {
        if (!isRecord(response) || !Array.isArray(response.Items)) {
          return [];
        }
        return response.Items;
      },
      parsePerson: (item) => {
        if (!isRecord(item) || !isString(item.Id) || !isString(item.Name)) return null;
        return {
          Id: item.Id,
          Name: item.Name,
          Overview: toStringValue(item.Overview),
          ImageTags: isRecord(item.ImageTags) ? toStringRecord(item.ImageTags) : undefined,
        };
      },
      normalizePersons: normalizeMediaServerPersons,
      toServiceError: toEmbyServiceError,
    },
    {
      statusMappings: {
        400: { code: "EMBY_BAD_REQUEST", message: "Invalid parameters for Emby person read request" },
        401: { code: "EMBY_AUTH_FAILED", message: "Emby API key is invalid or expired" },
        403: { code: "EMBY_PERMISSION_DENIED", message: "Current Emby credentials lack person read permissions" },
      },
      fallback: {
        code: "EMBY_UNREACHABLE",
        message: "Failed to read Emby person list",
      },
    },
  );

export const fetchEmbyPersonDetail = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
  person: EmbyPerson,
  userId: string,
): Promise<MediaServerItemDetail> => {
  const { TagItems: tagItems, ...detail } = await fetchMediaServerUserScopedItemDetail(
    {
      networkClient,
      configuration,
      serverKey: "emby",
      personId: person.Id,
      userId,
      createMissingUserContextError: () =>
        new EmbyServiceError(
          "EMBY_USER_CONTEXT_REQUIRED",
          "Current Emby server requires user context; please resolve and provide an Emby user ID before retrying",
        ),
      toServiceError: toEmbyServiceError,
    },
    {
      statusMappings: {
        401: {
          code: "EMBY_AUTH_FAILED",
          message: `Failed to read person details: Emby API key is invalid; cannot access ${person.Name}`,
        },
        403: {
          code: "EMBY_PERMISSION_DENIED",
          message: `Failed to read person details: current Emby API key has no permission to access ${person.Name}`,
        },
        404: { code: "EMBY_NOT_FOUND", message: `Person ${person.Name} does not exist in Emby` },
      },
      fallback: {
        code: "EMBY_UNREACHABLE",
        message: `Failed to read Emby person details: ${person.Name}`,
      },
    },
  );
  // Emby returns tags only as TagItems, and 4.8+ would apply TagItems over Tags when the detail is written back.
  return {
    ...detail,
    Tags: Array.isArray(tagItems) ? toStringArray(tagItems.map((tag) => (isRecord(tag) ? tag.Name : undefined))) : [],
  };
};

export const fetchEmbyMetadataEditorInfo = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
  personId: string,
): Promise<Record<string, unknown>> =>
  await fetchMediaServerMetadataEditorInfo(
    {
      networkClient,
      configuration,
      serverKey: "emby",
      personId,
      toServiceError: toEmbyServiceError,
    },
    {
      statusMappings: {
        401: {
          code: "EMBY_AUTH_FAILED",
          message: "Emby credentials are invalid; cannot verify person write permissions",
        },
        403: { code: "EMBY_PERMISSION_DENIED", message: "Current Emby credentials lack person write permissions" },
        404: { code: "EMBY_NOT_FOUND", message: "Emby cannot retrieve metadata editor info for person" },
      },
      fallback: {
        code: "EMBY_UNREACHABLE",
        message: "Failed to read Emby metadata editor info for person",
      },
    },
  );

export const deleteEmbyPrimaryImage = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
  personId: string,
): Promise<void> => {
  await deleteMediaServerPrimaryImage(
    {
      networkClient,
      configuration,
      serverKey: "emby",
      personId,
      toServiceError: toEmbyServiceError,
    },
    {
      statusMappings: {
        401: { code: "EMBY_AUTH_FAILED", message: "Emby API key is invalid; cannot remove person photo" },
        403: {
          code: "EMBY_ADMIN_KEY_REQUIRED",
          message: "Removing an Emby person photo requires an administrator API key",
        },
      },
      fallback: {
        code: "EMBY_WRITE_FAILED",
        message: "Failed to remove Emby person photo",
      },
    },
  );
};

export const updateEmbyPersonInfo = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
  person: EmbyPerson,
  detail: MediaServerItemDetail,
  synced: PlannedPersonSyncState,
): Promise<void> => {
  await updateMediaServerItem(
    {
      networkClient,
      configuration,
      serverKey: "emby",
      personId: person.Id,
      // Emby clears every field an update leaves out, and 4.5 rejects one without Genres or ProviderIds, so the person
      // goes back whole with only the synced fields replaced.
      payload: {
        ...detail,
        Overview: synced.overview ?? toStringValue(detail.Overview) ?? "",
        Tags: synced.tags,
        Taglines: synced.taglines,
        ...(synced.productionLocations?.length ? { ProductionLocations: synced.productionLocations } : {}),
        ...(synced.premiereDate ? { PremiereDate: synced.premiereDate } : {}),
        ...(synced.productionYear !== undefined ? { ProductionYear: synced.productionYear } : {}),
      },
      toServiceError: toEmbyServiceError,
    },
    {
      statusMappings: {
        400: { code: "EMBY_BAD_REQUEST", message: `Emby rejected person update: ${person.Name}` },
        401: { code: "EMBY_AUTH_FAILED", message: "Emby credentials are invalid; cannot write person info" },
        403: { code: "EMBY_PERMISSION_DENIED", message: "Current Emby credentials lack person write permissions" },
        404: { code: "EMBY_NOT_FOUND", message: `Person ${person.Name} does not exist in Emby` },
      },
      fallback: {
        code: "EMBY_WRITE_FAILED",
        message: `Failed to write Emby person info: ${person.Name}`,
      },
    },
  );
};

export const uploadEmbyPrimaryImage = async (
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
      serverKey: "emby",
      personId,
      bytes,
      contentType,
      retryableStatuses: [400, 404, 405],
      fallbackPath: primaryPath,
      fallbackQuery: { Index: "0" },
      toServiceError: toEmbyServiceError,
    },
    {
      statusMappings: {
        400: { code: "EMBY_BAD_REQUEST", message: "Emby rejected person photo upload request" },
        401: { code: "EMBY_AUTH_FAILED", message: "Emby API key is invalid; cannot upload person photo" },
        403: { code: "EMBY_ADMIN_KEY_REQUIRED", message: "Emby person photo upload requires an administrator API key" },
        415: { code: "EMBY_UNSUPPORTED_MEDIA", message: "Emby does not accept the current photo file type" },
      },
      fallback: {
        code: "EMBY_WRITE_FAILED",
        message: "Failed to upload Emby person photo",
      },
      fallbackStatusMappings: {
        400: { code: "EMBY_BAD_REQUEST", message: "Emby rejected person photo upload request" },
        401: { code: "EMBY_AUTH_FAILED", message: "Emby API key is invalid; cannot upload person photo" },
        403: { code: "EMBY_ADMIN_KEY_REQUIRED", message: "Emby person photo upload requires an administrator API key" },
        404: { code: "EMBY_NOT_FOUND", message: "Emby cannot find the person to upload photo for" },
        415: { code: "EMBY_UNSUPPORTED_MEDIA", message: "Emby does not accept the current photo file type" },
      },
    },
  );
};

export const checkEmbyConnection = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
): Promise<MediaServerConnectionCheckResult> =>
  await runMediaServerConnectionCheck({
    includeAdminKeyStep: true,
    unreachableCode: "EMBY_UNREACHABLE",
    authFailedCode: "EMBY_AUTH_FAILED",
    fetchPublicServerInfo: async () => {
      const info = await fetchEmbyPublicSystemInfo(networkClient, configuration);
      return {
        serverName: typeof info.ServerName === "string" ? info.ServerName : undefined,
        version: typeof info.Version === "string" ? info.Version : undefined,
      };
    },
    verifyAuth: async () => {
      await networkClient.getJson<Record<string, unknown>>(buildEmbyUrl(configuration, "/System/Endpoint"), {
        headers: buildEmbyHeaders(configuration, { accept: "application/json" }),
      });
    },
    // Reads people exactly as the sync does, so a server whose actor filter comes back empty fails here, not silently in sync.
    fetchPersons: async () =>
      await fetchEmbyPersons(networkClient, configuration, {
        ...(await resolveEmbyPersonQuery(networkClient, configuration)),
        limit: 1,
        fields: ["Overview"],
      }),
    getPersonId: (person) => person.Id,
    verifyWritePermission: async (personId) => {
      await fetchEmbyMetadataEditorInfo(networkClient, configuration, personId);
    },
  });

/**
 * The person query is resolved on first use, since a follow-up looks people up many times; a failed resolve is retried
 * on the next use instead of failing every later lookup.
 */
export const createEmbyPersonTarget = (
  deps: MediaServerActorServiceDependencies,
  configuration: Configuration,
  query?: EmbyPersonQuery,
): MediaServerPersonTarget<EmbyPerson> => {
  let resolvedQuery = query && Promise.resolve(query);
  const getQuery = async () => {
    resolvedQuery ??= resolveEmbyPersonQuery(deps.networkClient, configuration).catch((error: unknown) => {
      resolvedQuery = undefined;
      throw error;
    });
    return await resolvedQuery;
  };
  return {
    ...deps,
    serviceName: "Emby",
    configuration,
    findPerson: async (name) =>
      findPersonNamed(
        await fetchEmbyPersons(deps.networkClient, configuration, { ...(await getQuery()), searchTerm: name }),
        name,
      ),
    fetchPersonDetail: async (person) =>
      await fetchEmbyPersonDetail(deps.networkClient, configuration, person, (await getQuery()).userId),
    updatePersonInfo: async (person, detail, synced) =>
      await updateEmbyPersonInfo(deps.networkClient, configuration, person, detail, synced),
    uploadPrimaryImage: async (personId, bytes, contentType) =>
      await uploadEmbyPrimaryImage(deps.networkClient, configuration, personId, bytes, contentType),
    deletePrimaryImage: async (personId) => await deleteEmbyPrimaryImage(deps.networkClient, configuration, personId),
  };
};

export const syncEmbyPersons = async (
  deps: MediaServerActorServiceDependencies,
  configuration: Configuration,
  kind: PersonSyncKind,
  mode: MediaServerMode,
): Promise<PersonSyncResult> => {
  const query = await resolveEmbyPersonQuery(deps.networkClient, configuration);
  return await runMediaServerPersonSync(
    createEmbyPersonTarget(deps, configuration, query),
    kind === "info" ? { info: mode } : { photo: mode },
    await fetchEmbyPersons(deps.networkClient, configuration, {
      ...query,
      fields: kind === "info" ? ["Overview"] : undefined,
    }),
  );
};
