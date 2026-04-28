export const normalizeCookieDomain = (domain: string): string => domain.replace(/^\./u, "").trim().toLowerCase();

export const normalizeCookiePath = (path: string | undefined, fallbackPath = "/"): string => {
  const trimmed = path?.trim();
  if (!trimmed) {
    return fallbackPath;
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

export const resolveCookieAttributePath = (path: string | undefined, fallbackPath: string): string => {
  const trimmed = path?.trim();
  if (!trimmed || !trimmed.startsWith("/")) {
    return fallbackPath;
  }
  return trimmed;
};

export const cookieDomainMatches = (host: string, domain: string): boolean => {
  return host === domain || host.endsWith(`.${domain}`);
};

export const cookiePathMatches = (requestPath: string, cookiePath: string): boolean => {
  if (requestPath === cookiePath) {
    return true;
  }
  if (!requestPath.startsWith(cookiePath)) {
    return false;
  }
  return cookiePath.endsWith("/") || requestPath.charAt(cookiePath.length) === "/";
};

interface CookiePathAndDomain {
  domain: string;
  path: string;
}

export const filterCookiesForUrl = <TCookie extends CookiePathAndDomain>(
  cookies: ReadonlyArray<TCookie>,
  targetUrl: URL,
): TCookie[] => {
  const host = targetUrl.hostname.toLowerCase();
  const requestPath = normalizeCookiePath(targetUrl.pathname);

  return cookies.filter((cookie) => {
    return (
      cookieDomainMatches(host, normalizeCookieDomain(cookie.domain)) &&
      cookiePathMatches(requestPath, normalizeCookiePath(cookie.path))
    );
  });
};
