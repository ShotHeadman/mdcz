import type { Configuration } from "@main/services/config";
import {
  buildMediaServerHeaders,
  buildMediaServerUrl,
  type MediaServerHeadersInit,
  type MediaServerMode,
  normalizeMediaServerBaseUrl,
  parseMediaServerMode,
} from "@main/services/mediaServer/MediaServerClient";

export type JellyfinMode = MediaServerMode;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const normalizeBaseUrl = normalizeMediaServerBaseUrl;
export const parseMode = parseMediaServerMode;

export const isUuid = (value: string): boolean => {
  return UUID_PATTERN.test(value.trim());
};

export const buildJellyfinUrl = (
  configuration: Configuration,
  path: string,
  query: Record<string, string | undefined> = {},
): string => {
  return buildMediaServerUrl(configuration, "jellyfin", path, query);
};

export const buildJellyfinHeaders = (configuration: Configuration, headers: MediaServerHeadersInit = {}): Headers => {
  return buildMediaServerHeaders(configuration, "jellyfin", headers);
};
