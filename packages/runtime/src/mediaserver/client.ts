import type { Configuration } from "@mdcz/shared/config";
import type { RuntimeNetworkClient, RuntimeRequestInit } from "../network";
import { getHttpStatus, type MediaServerErrorMapping, type MediaServerServiceError } from "./errors";

export type MediaServerKey = "jellyfin" | "emby";
export type MediaServerMode = "all" | "missing";
export type MediaServerHeadersInit = Headers | Record<string, string> | Array<[string, string]>;
export type MediaServerItemDetail = Record<string, unknown>;

export interface MediaServerPersonBase {
  Id: string;
  Name: string;
}

const getMediaServerConfig = (configuration: Configuration, serverKey: MediaServerKey) =>
  serverKey === "jellyfin" ? configuration.jellyfin : configuration.emby;

export const normalizeMediaServerBaseUrl = (value: string): string => value.trim().replace(/\/+$/u, "");

export const buildMediaServerUrl = (
  configuration: Configuration,
  serverKey: MediaServerKey,
  path: string,
  query: Record<string, string | undefined> = {},
): string => {
  const baseUrl = normalizeMediaServerBaseUrl(getMediaServerConfig(configuration, serverKey).url);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (!baseUrl) {
    throw new Error(`${serverKey} URL is not configured`);
  }

  const url = new URL(`${baseUrl}${normalizedPath}`);
  for (const [key, value] of Object.entries(query)) {
    if (!value || value.trim().length === 0) {
      continue;
    }
    url.searchParams.set(key, value);
  }

  return url.toString();
};

/** Public endpoints pass `authenticated: false` so diagnostics can tell reachability from auth failures. */
export const buildMediaServerRequestInit = (
  configuration: Configuration,
  serverKey: MediaServerKey,
  headersInit: MediaServerHeadersInit = {},
  { authenticated = true }: { authenticated?: boolean } = {},
): RuntimeRequestInit => {
  const { apiKey, useProxy } = getMediaServerConfig(configuration, serverKey);
  const headers = new Headers(headersInit);
  const token = authenticated ? apiKey.trim() : "";
  // Jellyfin 12 disables legacy token headers and api_key by default; Emby documents X-Emby-Token for API keys.
  if (token && serverKey === "jellyfin") headers.set("authorization", `MediaBrowser Token="${token}"`);
  else if (token) headers.set("x-emby-token", token);
  return { headers, bypassProxy: !useProxy };
};

export const normalizeMediaServerPersons = <TPerson extends MediaServerPersonBase>(
  persons: ReadonlyArray<TPerson>,
): TPerson[] => {
  const uniquePersons = new Map<string, TPerson>();

  for (const person of persons) {
    const normalizedName = person.Name.trim();
    if (!normalizedName) {
      continue;
    }

    uniquePersons.set(person.Id, {
      ...person,
      Name: normalizedName,
    });
  }

  return Array.from(uniquePersons.values());
};

interface MediaServerRequestOptions<TError extends MediaServerServiceError> {
  networkClient: RuntimeNetworkClient;
  configuration: Configuration;
  serverKey: MediaServerKey;
  personId: string;
  toServiceError: (
    error: unknown,
    statusMappings: Partial<Record<number, MediaServerErrorMapping>>,
    fallback: MediaServerErrorMapping,
  ) => TError;
}

interface MediaServerRequestErrorMappings {
  statusMappings: Partial<Record<number, MediaServerErrorMapping>>;
  fallback: MediaServerErrorMapping;
}

interface FetchMediaServerPersonsOptions<TPerson, TError extends MediaServerServiceError>
  extends Omit<MediaServerRequestOptions<TError>, "personId"> {
  path?: string;
  query?: Record<string, string | undefined>;
  extractItems: (response: unknown) => unknown[];
  parsePerson: (item: unknown) => TPerson | null;
  normalizePersons?: (persons: TPerson[]) => TPerson[];
}

export const fetchMediaServerPersons = async <TPerson, TError extends MediaServerServiceError>(
  options: FetchMediaServerPersonsOptions<TPerson, TError>,
  errorMappings: MediaServerRequestErrorMappings,
): Promise<TPerson[]> => {
  const url = buildMediaServerUrl(options.configuration, options.serverKey, options.path ?? "/Persons", options.query);

  try {
    const response = await options.networkClient.getJson<unknown>(
      url,
      buildMediaServerRequestInit(options.configuration, options.serverKey, {
        accept: "application/json",
      }),
    );

    const persons = options.extractItems(response).flatMap((item): TPerson[] => {
      const parsed = options.parsePerson(item);
      return parsed ? [parsed] : [];
    });

    return options.normalizePersons ? options.normalizePersons(persons) : persons;
  } catch (error) {
    throw options.toServiceError(error, errorMappings.statusMappings, errorMappings.fallback);
  }
};

export const fetchMediaServerItemDetail = async <
  TDetail extends MediaServerItemDetail,
  TError extends MediaServerServiceError,
>(
  options: Omit<MediaServerRequestOptions<TError>, "personId"> & {
    path: string;
  },
  errorMappings: MediaServerRequestErrorMappings,
): Promise<TDetail> => {
  const url = buildMediaServerUrl(options.configuration, options.serverKey, options.path);

  try {
    return await options.networkClient.getJson<TDetail>(
      url,
      buildMediaServerRequestInit(options.configuration, options.serverKey, {
        accept: "application/json",
      }),
    );
  } catch (error) {
    throw options.toServiceError(error, errorMappings.statusMappings, errorMappings.fallback);
  }
};

interface FetchMediaServerResolvedUserIdOptions<TError extends MediaServerServiceError>
  extends Omit<MediaServerRequestOptions<TError>, "personId"> {
  path: string;
  extractUsers: (response: unknown) => Array<{ Id?: unknown; Policy?: unknown }>;
  pickUserId: (users: ReadonlyArray<{ Id?: unknown; Policy?: unknown }>) => string | undefined;
  createMissingUserContextError: () => TError;
}

export const fetchMediaServerResolvedUserId = async <TError extends MediaServerServiceError>(
  options: FetchMediaServerResolvedUserIdOptions<TError>,
  errorMappings: MediaServerRequestErrorMappings,
): Promise<string> => {
  const url = buildMediaServerUrl(options.configuration, options.serverKey, options.path);

  let response: unknown;
  try {
    response = await options.networkClient.getJson<unknown>(
      url,
      buildMediaServerRequestInit(options.configuration, options.serverKey, {
        accept: "application/json",
      }),
    );
  } catch (error) {
    throw options.toServiceError(error, errorMappings.statusMappings, errorMappings.fallback);
  }

  const userId = options.pickUserId(options.extractUsers(response));
  if (!userId) {
    throw options.createMissingUserContextError();
  }

  return userId;
};

export const fetchMediaServerUserScopedItemDetail = async <
  TDetail extends MediaServerItemDetail,
  TError extends MediaServerServiceError,
>(
  options: Omit<MediaServerRequestOptions<TError>, "personId"> & {
    personId: string;
    userId: string;
    createMissingUserContextError: () => TError;
  },
  errorMappings: MediaServerRequestErrorMappings,
): Promise<TDetail> => {
  const resolvedUserId = options.userId.trim();
  if (!resolvedUserId) {
    throw options.createMissingUserContextError();
  }

  return await fetchMediaServerItemDetail<TDetail, TError>(
    {
      networkClient: options.networkClient,
      configuration: options.configuration,
      serverKey: options.serverKey,
      path: `/Users/${encodeURIComponent(resolvedUserId)}/Items/${encodeURIComponent(options.personId)}`,
      toServiceError: options.toServiceError,
    },
    errorMappings,
  );
};

export const fetchMediaServerMetadataEditorInfo = async <TError extends MediaServerServiceError>(
  options: MediaServerRequestOptions<TError>,
  errorMappings: MediaServerRequestErrorMappings,
): Promise<Record<string, unknown>> => {
  const url = buildMediaServerUrl(
    options.configuration,
    options.serverKey,
    `/Items/${encodeURIComponent(options.personId)}/MetadataEditor`,
  );

  try {
    return await options.networkClient.getJson<Record<string, unknown>>(
      url,
      buildMediaServerRequestInit(options.configuration, options.serverKey, {
        accept: "application/json",
      }),
    );
  } catch (error) {
    throw options.toServiceError(error, errorMappings.statusMappings, errorMappings.fallback);
  }
};

export const deleteMediaServerPrimaryImage = async <TError extends MediaServerServiceError>(
  options: MediaServerRequestOptions<TError>,
  errorMappings: MediaServerRequestErrorMappings,
): Promise<void> => {
  const url = buildMediaServerUrl(
    options.configuration,
    options.serverKey,
    `/Items/${encodeURIComponent(options.personId)}/Images/Primary`,
  );

  try {
    await options.networkClient.deleteText(url, buildMediaServerRequestInit(options.configuration, options.serverKey));
  } catch (error) {
    throw options.toServiceError(error, errorMappings.statusMappings, errorMappings.fallback);
  }
};

export const updateMediaServerItem = async <TError extends MediaServerServiceError>(
  options: MediaServerRequestOptions<TError> & {
    payload: Record<string, unknown>;
  },
  errorMappings: MediaServerRequestErrorMappings,
): Promise<void> => {
  const url = buildMediaServerUrl(
    options.configuration,
    options.serverKey,
    `/Items/${encodeURIComponent(options.personId)}`,
  );

  try {
    await options.networkClient.postText(
      url,
      JSON.stringify(options.payload),
      buildMediaServerRequestInit(options.configuration, options.serverKey, {
        "content-type": "application/json",
      }),
    );
  } catch (error) {
    throw options.toServiceError(error, errorMappings.statusMappings, errorMappings.fallback);
  }
};

export const uploadMediaServerPrimaryImage = async <TError extends MediaServerServiceError>(
  options: Omit<MediaServerRequestOptions<TError>, "personId"> & {
    personId: string;
    bytes: Uint8Array;
    contentType: string;
    retryableStatuses?: number[];
    fallbackPath?: string;
    fallbackQuery?: Record<string, string | undefined>;
  },
  errorMappings: MediaServerRequestErrorMappings & {
    fallbackStatusMappings?: Partial<Record<number, MediaServerErrorMapping>>;
    fallbackFallback?: MediaServerErrorMapping;
  },
): Promise<void> => {
  const primaryPath = `/Items/${encodeURIComponent(options.personId)}/Images/Primary`;
  const body = Buffer.from(options.bytes).toString("base64");
  const requestInit = buildMediaServerRequestInit(options.configuration, options.serverKey, {
    "content-type": options.contentType,
  });

  try {
    await options.networkClient.postText(
      buildMediaServerUrl(options.configuration, options.serverKey, primaryPath),
      body,
      requestInit,
    );
    return;
  } catch (error) {
    const retryableStatuses = new Set(options.retryableStatuses ?? []);
    const status = getHttpStatus(error);
    if (!options.fallbackPath || status === undefined || !retryableStatuses.has(status)) {
      throw options.toServiceError(error, errorMappings.statusMappings, errorMappings.fallback);
    }
  }

  try {
    await options.networkClient.postText(
      buildMediaServerUrl(options.configuration, options.serverKey, options.fallbackPath, options.fallbackQuery),
      body,
      requestInit,
    );
  } catch (error) {
    throw options.toServiceError(
      error,
      errorMappings.fallbackStatusMappings ?? errorMappings.statusMappings,
      errorMappings.fallbackFallback ?? errorMappings.fallback,
    );
  }
};
