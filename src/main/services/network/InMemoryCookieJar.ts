import type { ResolvedCookie } from "./CookieResolver";
import { filterCookiesForUrl, normalizeCookieDomain, resolveCookieAttributePath } from "./cookieUtils";
import type { NetworkCookieJar } from "./NetworkClient";

interface ParsedSetCookie extends ResolvedCookie {
  expired?: boolean;
}

const defaultCookiePath = (pathname: string): string => {
  if (!pathname || !pathname.startsWith("/")) {
    return "/";
  }

  const lastSlash = pathname.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : pathname.slice(0, lastSlash);
};

const parseSetCookie = (cookieHeader: string, url: string): ParsedSetCookie | null => {
  const targetUrl = new URL(url);
  const [cookiePair, ...attributes] = cookieHeader.split(";");
  const separatorIndex = cookiePair.indexOf("=");
  if (separatorIndex <= 0) {
    return null;
  }

  const name = cookiePair.slice(0, separatorIndex).trim();
  const value = cookiePair.slice(separatorIndex + 1).trim();
  if (!name) {
    return null;
  }

  let domain = targetUrl.hostname;
  let path = defaultCookiePath(targetUrl.pathname);
  let expired = false;

  for (const attribute of attributes) {
    const [rawKey, ...rawValueParts] = attribute.split("=");
    const key = rawKey.trim().toLowerCase();
    const attributeValue = rawValueParts.join("=").trim();

    if (key === "domain" && attributeValue) {
      domain = attributeValue;
      continue;
    }

    if (key === "path" && attributeValue) {
      path = attributeValue;
      continue;
    }

    if (key === "max-age") {
      const maxAge = Number.parseInt(attributeValue, 10);
      if (Number.isFinite(maxAge) && maxAge <= 0) {
        expired = true;
      }
      continue;
    }

    if (key === "expires") {
      const expiresAt = Date.parse(attributeValue);
      if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
        expired = true;
      }
    }
  }

  return {
    name,
    value,
    domain: normalizeCookieDomain(domain),
    path: resolveCookieAttributePath(path, defaultCookiePath(targetUrl.pathname)),
    expired,
  };
};

export class InMemoryCookieJar implements NetworkCookieJar {
  private readonly store = new Map<string, ResolvedCookie>();

  getCookieString(url: string): string {
    const targetUrl = new URL(url);

    return filterCookiesForUrl(Array.from(this.store.values()), targetUrl)
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
  }

  setCookie(cookieHeader: string, url: string): void {
    const parsed = parseSetCookie(cookieHeader, url);
    if (!parsed) {
      return;
    }

    const key = this.toKey(parsed);
    if (parsed.expired) {
      this.store.delete(key);
      return;
    }

    this.store.set(key, parsed);
  }

  setResolvedCookies(cookies: ReadonlyArray<ResolvedCookie>, url: string): void {
    const targetUrl = new URL(url);
    const fallbackPath = defaultCookiePath(targetUrl.pathname);

    for (const cookie of cookies) {
      const normalized: ResolvedCookie = {
        name: cookie.name.trim(),
        value: cookie.value,
        domain: normalizeCookieDomain(cookie.domain || targetUrl.hostname),
        path: resolveCookieAttributePath(cookie.path, fallbackPath),
      };

      if (!normalized.name) {
        continue;
      }

      this.store.set(this.toKey(normalized), normalized);
    }
  }

  private toKey(cookie: ResolvedCookie): string {
    return `${cookie.domain}|${cookie.path}|${cookie.name}`;
  }
}
