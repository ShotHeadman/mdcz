import type { Configuration } from "@mdcz/shared/config";
import type { MediaServerConnectionCheckResult, PersonSyncResult } from "@mdcz/shared/ipcTypes";
import type { RuntimeNetworkClient } from "../network";
import type { RuntimeLogger } from "../shared";
import {
  buildMediaServerHeaders,
  buildMediaServerUrl,
  fetchMediaServerMetadataEditorInfo,
  fetchMediaServerPersons,
  fetchMediaServerResolvedUserId,
  fetchMediaServerUserScopedItemDetail,
  type MediaServerHeadersInit,
  type MediaServerItemDetail,
  type MediaServerMode,
  normalizeMediaServerBaseUrl,
  normalizeMediaServerPersons,
  parseMediaServerMode,
  refreshMediaServerPerson,
  updateMediaServerItem,
  uploadMediaServerPrimaryImage,
} from "./client";
import { isRecord, isString, pickAutoResolvedUserId, toStringArray, toStringRecord, toStringValue } from "./common";
import { runMediaServerConnectionCheck } from "./connectionCheck";
import {
  getHttpStatus,
  type MediaServerErrorMapping,
  MediaServerServiceError,
  toMediaServerServiceError,
} from "./errors";
import type { RuntimeInfoActorSourceProvider } from "./infoSync";
import { runMediaServerInfoSync } from "./infoSync";
import type { MediaServerSignalService } from "./jellyfin";
import type { RuntimePhotoActorSourceProvider } from "./photoSync";
import { runMediaServerPhotoSync } from "./photoSync";
import type { PlannedPersonSyncState } from "./planner";

export type EmbyMode = MediaServerMode;
export type EmbyBatchResult = PersonSyncResult;
export type EmbyItemDetail = MediaServerItemDetail;

export interface EmbyPerson {
  Id: string;
  Name: string;
  ServerId?: string;
  Overview?: string;
  ImageTags?: Record<string, string>;
}

export class EmbyServiceError extends MediaServerServiceError {}

export interface EmbyActorServiceDependencies {
  signalService: MediaServerSignalService;
  networkClient: RuntimeNetworkClient;
  actorSourceProvider: RuntimeInfoActorSourceProvider & RuntimePhotoActorSourceProvider;
  logger: RuntimeLogger;
}

export const normalizeEmbyBaseUrl = normalizeMediaServerBaseUrl;
export const parseEmbyMode = parseMediaServerMode;

export { getHttpStatus };

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

export const hasEmbyPrimaryImage = (person: EmbyPerson): boolean =>
  typeof person.ImageTags?.Primary === "string" && person.ImageTags.Primary.trim().length > 0;

const ACTOR_PERSON_TYPES = ["Actor", "GuestStar"] as const;

type EmbyFetchPersonsOptions = {
  limit?: number;
  fields?: string[];
  userId?: string;
  personTypes?: string[];
};

const fetchAutoResolvedEmbyUserId = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
): Promise<string> =>
  await fetchMediaServerResolvedUserId(
    {
      networkClient,
      configuration,
      serverKey: "emby",
      path: "/Users/Query",
      extractUsers: (response) => (isRecord(response) && Array.isArray(response.Items) ? response.Items : []),
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

export const resolveEmbyUserId = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
  overrideUserId?: string,
): Promise<string> => {
  const resolvedUserId = overrideUserId?.trim() || configuration.emby.userId.trim();
  return resolvedUserId || (await fetchAutoResolvedEmbyUserId(networkClient, configuration));
};

export const fetchEmbyPersons = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
  options: EmbyFetchPersonsOptions = {},
): Promise<EmbyPerson[]> => {
  const userId = options.userId?.trim() || configuration.emby.userId.trim() || undefined;

  return await fetchMediaServerPersons(
    {
      networkClient,
      configuration,
      serverKey: "emby",
      query: {
        userid: userId,
        Limit: options.limit !== undefined ? String(options.limit) : undefined,
        Fields: options.fields?.join(","),
        PersonTypes: options.personTypes?.join(","),
      },
      extractItems: (response) => {
        if (!isRecord(response) || !Array.isArray(response.Items)) {
          return [];
        }
        return response.Items;
      },
      parsePerson: (item) => {
        if (!isRecord(item)) {
          return null;
        }

        const id = item.Id;
        const name = item.Name;
        if (!isString(id) || !isString(name)) {
          return null;
        }

        return {
          Id: id,
          Name: name,
          ServerId: isString(item.ServerId) ? item.ServerId : undefined,
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
};

export const fetchEmbyActorPersons = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
  options: Omit<EmbyFetchPersonsOptions, "personTypes"> = {},
): Promise<EmbyPerson[]> => {
  const userId = await resolveEmbyUserId(networkClient, configuration, options.userId);
  return await fetchEmbyPersons(networkClient, configuration, {
    ...options,
    userId,
    personTypes: [...ACTOR_PERSON_TYPES],
  });
};

export const fetchEmbyPersonDetail = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
  person: EmbyPerson,
  userId: string,
): Promise<EmbyItemDetail> =>
  await fetchMediaServerUserScopedItemDetail(
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

export const buildEmbyPersonUpdatePayload = (
  person: EmbyPerson,
  detail: EmbyItemDetail,
  synced: PlannedPersonSyncState,
): Record<string, unknown> => {
  const hasOwn = (key: string): boolean => Object.hasOwn(detail, key);
  const payload: Record<string, unknown> = {
    Id: person.Id,
    Name: toStringValue(detail.Name) ?? person.Name,
    Overview: synced.overview ?? toStringValue(detail.Overview) ?? "",
    Tags: synced.tags,
    Taglines: synced.taglines,
  };

  if (hasOwn("ProviderIds")) payload.ProviderIds = toStringRecord(detail.ProviderIds);
  if (hasOwn("LockedFields")) payload.LockedFields = toStringArray(detail.LockedFields);
  if (typeof detail.LockData === "boolean") payload.LockData = detail.LockData;

  const serverId = toStringValue(detail.ServerId) ?? person.ServerId;
  if (serverId) payload.ServerId = serverId;

  const genres = toStringArray(detail.Genres);
  if (genres.length > 0) payload.Genres = genres;

  const type = toStringValue(detail.Type);
  if (type) payload.Type = type;

  if (synced.productionLocations && synced.productionLocations.length > 0) {
    payload.ProductionLocations = synced.productionLocations;
  }
  if (synced.premiereDate) payload.PremiereDate = synced.premiereDate;
  if (synced.productionYear !== undefined) payload.ProductionYear = synced.productionYear;

  return payload;
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

export const refreshEmbyPerson = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
  personId: string,
): Promise<void> => {
  await refreshMediaServerPerson(
    {
      networkClient,
      configuration,
      serverKey: "emby",
      personId,
      toServiceError: toEmbyServiceError,
    },
    {
      statusMappings: {
        400: { code: "EMBY_BAD_REQUEST", message: "Emby rejected person refresh request" },
        401: { code: "EMBY_AUTH_FAILED", message: "Emby credentials are invalid; cannot refresh person" },
        403: { code: "EMBY_PERMISSION_DENIED", message: "Current Emby credentials lack person refresh permissions" },
        404: { code: "EMBY_NOT_FOUND", message: "Emby cannot refresh specified person" },
      },
      fallback: {
        code: "EMBY_REFRESH_FAILED",
        message: "Failed to refresh Emby person",
      },
    },
  );
};

export const updateEmbyPersonInfo = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
  person: EmbyPerson,
  detail: EmbyItemDetail,
  synced: PlannedPersonSyncState,
): Promise<void> => {
  const payload = buildEmbyPersonUpdatePayload(person, detail, synced);
  await updateMediaServerItem(
    {
      networkClient,
      configuration,
      serverKey: "emby",
      personId: person.Id,
      payload,
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

interface PublicSystemInfo {
  ServerName?: string;
  Version?: string;
}

export const checkEmbyConnection = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
): Promise<MediaServerConnectionCheckResult> => {
  let resolvedUserId: string | undefined;
  const getResolvedUserId = async (): Promise<string> => {
    if (!resolvedUserId) {
      resolvedUserId = await resolveEmbyUserId(networkClient, configuration);
    }
    return resolvedUserId;
  };

  return await runMediaServerConnectionCheck({
    includeAdminKeyStep: true,
    unreachableCode: "EMBY_UNREACHABLE",
    authFailedCode: "EMBY_AUTH_FAILED",
    fetchPublicServerInfo: async () => {
      const info = await networkClient.getJson<PublicSystemInfo>(buildEmbyUrl(configuration, "/System/Info/Public"), {
        headers: { accept: "application/json" },
      });
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
    fetchPersons: async () =>
      await fetchEmbyPersons(networkClient, configuration, {
        limit: 1,
        fields: ["Overview"],
        userId: await getResolvedUserId(),
      }),
    getPersonId: (person) => person.Id,
    verifyWritePermission: async (personId) => {
      await fetchEmbyMetadataEditorInfo(networkClient, configuration, personId);
    },
  });
};

export class EmbyActorInfoService {
  private readonly networkClient: RuntimeNetworkClient;

  constructor(private readonly deps: EmbyActorServiceDependencies) {
    this.networkClient = deps.networkClient;
  }

  async run(configuration: Configuration, mode: EmbyMode): Promise<EmbyBatchResult> {
    const resolvedUserId = await resolveEmbyUserId(this.networkClient, configuration);
    return await runMediaServerInfoSync({
      configuration,
      mode,
      serviceName: "Emby",
      signalService: this.deps.signalService,
      actorSourceProvider: this.deps.actorSourceProvider,
      logger: this.deps.logger,
      fetchPersons: async () =>
        await fetchEmbyActorPersons(this.networkClient, configuration, {
          fields: ["Overview"],
          userId: resolvedUserId,
        }),
      getPersonName: (person) => person.Name,
      getPersonId: (person) => person.Id,
      fetchPersonDetail: async (person) =>
        await fetchEmbyPersonDetail(this.networkClient, configuration, person, resolvedUserId),
      buildExistingState: (person, detail) => ({
        overview: toStringValue(detail.Overview) ?? person.Overview,
        tags: toStringArray(detail.Tags),
        taglines: toStringArray(detail.Taglines),
        premiereDate: toStringValue(detail.PremiereDate),
        productionYear: typeof detail.ProductionYear === "number" ? detail.ProductionYear : undefined,
        productionLocations: toStringArray(detail.ProductionLocations),
      }),
      updatePersonInfo: async (person, detail, synced) => {
        await updateEmbyPersonInfo(this.networkClient, configuration, person, detail, synced);
      },
      shouldRefreshPerson: configuration.emby.refreshPersonAfterSync,
      refreshPerson: async (personId) => {
        await refreshEmbyPerson(this.networkClient, configuration, personId);
      },
      buildCompletionMessage: (result, total) =>
        `Emby actor info sync completed. Total: ${total}, Success: ${result.processedCount}, Failed: ${result.failedCount}, Skipped: ${result.skippedCount}`,
    });
  }
}

export class EmbyActorPhotoService {
  private readonly networkClient: RuntimeNetworkClient;

  constructor(private readonly deps: EmbyActorServiceDependencies) {
    this.networkClient = deps.networkClient;
  }

  async run(configuration: Configuration, mode: EmbyMode): Promise<EmbyBatchResult> {
    const resolvedUserId = await resolveEmbyUserId(this.networkClient, configuration);
    return await runMediaServerPhotoSync({
      configuration,
      mode,
      serviceName: "Emby",
      signalService: this.deps.signalService,
      networkClient: this.networkClient,
      actorSourceProvider: this.deps.actorSourceProvider,
      logger: this.deps.logger,
      fetchPersons: async () =>
        await fetchEmbyActorPersons(this.networkClient, configuration, {
          userId: resolvedUserId,
        }),
      getPersonName: (person) => person.Name,
      getPersonId: (person) => person.Id,
      hasPrimaryImage: hasEmbyPrimaryImage,
      uploadPrimaryImage: async (personId, bytes, contentType) => {
        await uploadEmbyPrimaryImage(this.networkClient, configuration, personId, bytes, contentType);
      },
      shouldRefreshPerson: configuration.emby.refreshPersonAfterSync,
      refreshPerson: async (personId) => {
        await refreshEmbyPerson(this.networkClient, configuration, personId);
      },
      buildCompletionMessage: (result, total) =>
        `Emby actor photo sync completed. Total: ${total}, Success: ${result.processedCount}, Failed: ${result.failedCount}, Skipped: ${result.skippedCount}`,
    });
  }
}
