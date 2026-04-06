import type { Configuration } from "@main/services/config";
import type { NetworkClient } from "@main/services/network";
import { getHttpStatus, type MediaServerErrorMapping, type MediaServerServiceError } from "./MediaServerError";

export type MediaServerKey = "jellyfin" | "emby";
export type MediaServerMode = "all" | "missing";
export type MediaServerHeadersInit = Headers | Record<string, string> | Array<[string, string]>;
export type MediaServerItemDetail = Record<string, unknown>;

export interface MediaServerPersonBase {
  Id: string;
  Name: string;
}

const getMediaServerConfig = (configuration: Configuration, serverKey: MediaServerKey) => {
  return serverKey === "jellyfin" ? configuration.jellyfin : configuration.emby;
};

export const normalizeMediaServerBaseUrl = (value: string): string => {
  return value.trim().replace(/\/+$/u, "");
};

export const parseMediaServerMode = (value: unknown): MediaServerMode | null => {
  if (value === "all" || value === "missing") {
    return value;
  }
  return null;
};

export const buildMediaServerUrl = (
  configuration: Configuration,
  serverKey: MediaServerKey,
  path: string,
  query: Record<string, string | undefined> = {},
): string => {
  const baseUrl = normalizeMediaServerBaseUrl(getMediaServerConfig(configuration, serverKey).url);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${baseUrl}${normalizedPath}`);
  const apiKey = getMediaServerConfig(configuration, serverKey).apiKey.trim();

  if (apiKey) {
    url.searchParams.set("api_key", apiKey);
  }

  for (const [key, value] of Object.entries(query)) {
    if (!value || value.trim().length === 0) {
      continue;
    }
    url.searchParams.set(key, value);
  }

  return url.toString();
};

export const buildMediaServerHeaders = (
  configuration: Configuration,
  serverKey: MediaServerKey,
  headers: MediaServerHeadersInit = {},
): Headers => {
  const next = new Headers(headers);
  const apiKey = getMediaServerConfig(configuration, serverKey).apiKey.trim();
  if (!apiKey) {
    return next;
  }

  next.set("x-emby-token", apiKey);
  next.set(
    "x-emby-authorization",
    `MediaBrowser Client="MDCz", Device="MDCz", DeviceId="mdcz-tool", Version="0.1.3", Token="${apiKey}"`,
  );

  return next;
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
  networkClient: NetworkClient;
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
    const response = await options.networkClient.getJson<unknown>(url, {
      headers: buildMediaServerHeaders(options.configuration, options.serverKey, {
        accept: "application/json",
      }),
    });

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
    return await options.networkClient.getJson<TDetail>(url, {
      headers: buildMediaServerHeaders(options.configuration, options.serverKey, {
        accept: "application/json",
      }),
    });
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
    response = await options.networkClient.getJson<unknown>(url, {
      headers: buildMediaServerHeaders(options.configuration, options.serverKey, {
        accept: "application/json",
      }),
    });
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
    return await options.networkClient.getJson<Record<string, unknown>>(url, {
      headers: buildMediaServerHeaders(options.configuration, options.serverKey, {
        accept: "application/json",
      }),
    });
  } catch (error) {
    throw options.toServiceError(error, errorMappings.statusMappings, errorMappings.fallback);
  }
};

export const refreshMediaServerPerson = async <TError extends MediaServerServiceError>(
  options: MediaServerRequestOptions<TError>,
  errorMappings: MediaServerRequestErrorMappings,
): Promise<void> => {
  const url = buildMediaServerUrl(
    options.configuration,
    options.serverKey,
    `/Items/${encodeURIComponent(options.personId)}/Refresh`,
    {
      Recursive: "false",
      MetadataRefreshMode: "FullRefresh",
      ImageRefreshMode: "FullRefresh",
      ReplaceAllMetadata: "false",
      ReplaceAllImages: "false",
    },
  );

  try {
    await options.networkClient.postText(url, "", {
      headers: buildMediaServerHeaders(options.configuration, options.serverKey),
    });
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
    await options.networkClient.postText(url, JSON.stringify(options.payload), {
      headers: buildMediaServerHeaders(options.configuration, options.serverKey, {
        "content-type": "application/json",
      }),
    });
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
  const headers = buildMediaServerHeaders(options.configuration, options.serverKey, {
    "content-type": options.contentType,
  });

  try {
    await options.networkClient.postText(
      buildMediaServerUrl(options.configuration, options.serverKey, primaryPath),
      body,
      {
        headers,
      },
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
      {
        headers,
      },
    );
  } catch (error) {
    throw options.toServiceError(
      error,
      errorMappings.fallbackStatusMappings ?? errorMappings.statusMappings,
      errorMappings.fallbackFallback ?? errorMappings.fallback,
    );
  }
};
