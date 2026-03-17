import type { Configuration } from "@main/services/config";

export type JellyfinMode = "all" | "missing";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const normalizeBaseUrl = (value: string): string => {
  return value.trim().replace(/\/+$/u, "");
};

export const parseMode = (value: unknown): JellyfinMode | null => {
  if (value === "all" || value === "missing") {
    return value;
  }
  return null;
};

export const isUuid = (value: string): boolean => {
  return UUID_PATTERN.test(value.trim());
};

export const buildJellyfinUrl = (
  configuration: Configuration,
  path: string,
  query: Record<string, string | undefined> = {},
): string => {
  const baseUrl = normalizeBaseUrl(configuration.jellyfin.url);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${baseUrl}${normalizedPath}`);

  if (configuration.jellyfin.apiKey.trim()) {
    url.searchParams.set("api_key", configuration.jellyfin.apiKey.trim());
  }

  for (const [key, value] of Object.entries(query)) {
    if (!value || value.trim().length === 0) {
      continue;
    }
    url.searchParams.set(key, value);
  }

  return url.toString();
};

type JellyfinHeadersInit = Headers | Record<string, string> | Array<[string, string]>;

export const buildJellyfinHeaders = (configuration: Configuration, headers: JellyfinHeadersInit = {}): Headers => {
  const next = new Headers(headers);
  const apiKey = configuration.jellyfin.apiKey.trim();
  const tokenHeader = apiKey.length > 0 ? apiKey : "";

  if (tokenHeader) {
    next.set("x-emby-token", tokenHeader);
    next.set(
      "x-emby-authorization",
      `MediaBrowser Client="MDCz", Device="MDCz", DeviceId="mdcz-tool", Version="0.1.3", Token="${tokenHeader}"`,
    );
  }

  return next;
};
