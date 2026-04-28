import type { FetchOptions } from "@main/services/crawler/FetchGateway";

export const DMM_DEFAULT_COOKIE_HEADER = "age_check_done=1; ckcy=1; cklg=ja";

export const normalizeDmmCookieHeader = (cookieHeader?: string): string => {
  const incoming = cookieHeader?.trim();
  return incoming && incoming.length > 0 ? incoming : DMM_DEFAULT_COOKIE_HEADER;
};

export const buildDmmHttpHeaders = (extraHeaders: Record<string, string> = {}): Record<string, string> => {
  return {
    "accept-language": "ja-JP,ja;q=0.9",
    ...extraHeaders,
  };
};

export const buildDmmHttpOptions = (cookieHeader: string | undefined, extra: FetchOptions = {}): FetchOptions => {
  return {
    ...extra,
    headers: buildDmmHttpHeaders(extra.headers),
    cookies: normalizeDmmCookieHeader(cookieHeader),
  };
};
