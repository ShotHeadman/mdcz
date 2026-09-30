import { type Configuration, resolveSiteUrl } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import type { NetworkCookieCheckStatus } from "@mdcz/shared/serverDtos";
import { classifyJavbusPage, JAVBUS_PAGE_HEADERS, toErrorMessage } from "../shared";

interface CookieCheckNetworkClient {
  getText(url: string, init?: { headers?: Record<string, string> }): Promise<string>;
}

export interface CookieCheckResult {
  site: string;
  valid: boolean;
  status: NetworkCookieCheckStatus;
  error?: string;
}

const toCookieSafeErrorMessage = (error: unknown, cookie: string): string => {
  // Redact the full cookie plus each pair and each value, so partial echoes
  // (a single key=value or a bare value) never leak into user-facing messages.
  const secrets = [cookie, ...cookie.split(";").flatMap((pair) => [pair.trim(), pair.split("=").slice(1).join("=")])]
    .filter((secret) => secret.length >= 4)
    .sort((a, b) => b.length - a.length);
  let message = toErrorMessage(error);
  for (const secret of secrets) {
    message = message.replaceAll(secret, "[REDACTED]");
  }
  return message;
};

const cookieCheckResult = (site: string, status: NetworkCookieCheckStatus): CookieCheckResult => ({
  site,
  valid: status === "ready_with_cookie" || status === "ready_without_cookie",
  status,
});

const requestFailed = (site: string, error: unknown, cookie: string): CookieCheckResult => ({
  ...cookieCheckResult(site, "request_failed"),
  error: toCookieSafeErrorMessage(error, cookie),
});

const checkJavdbCookie = async (
  siteUrl: string,
  cookie: string,
  networkClient: CookieCheckNetworkClient,
): Promise<CookieCheckResult> => {
  if (!cookie) return cookieCheckResult("JavDB", "not_configured");

  try {
    const html = await networkClient.getText(`${siteUrl}/users/profile`, {
      headers: { cookie },
    });
    const valid = !html.includes('href="/login"') && !html.includes("sign_in");
    return cookieCheckResult("JavDB", valid ? "ready_with_cookie" : "invalid_or_expired");
  } catch (error) {
    return requestFailed("JavDB", error, cookie);
  }
};

const checkJavbusCookie = async (
  siteUrl: string,
  cookie: string,
  networkClient: CookieCheckNetworkClient,
): Promise<CookieCheckResult> => {
  try {
    const html = await networkClient.getText(`${siteUrl}/`, {
      headers: {
        ...JAVBUS_PAGE_HEADERS,
        ...(cookie ? { cookie } : {}),
      },
    });
    const page = classifyJavbusPage(html);
    if (page === "content") return cookieCheckResult("JavBus", cookie ? "ready_with_cookie" : "ready_without_cookie");
    return cookieCheckResult("JavBus", page === "unknown" ? "unexpected_page" : page);
  } catch (error) {
    return requestFailed("JavBus", error, cookie);
  }
};

const checkFantiaCookie = async (
  cookie: string,
  networkClient: CookieCheckNetworkClient,
): Promise<CookieCheckResult> => {
  if (!cookie) return cookieCheckResult("Fantia", "not_configured");

  try {
    const html = await networkClient.getText("https://fantia.jp/mypage/dashboard", {
      headers: { cookie },
    });
    if (html.includes("外部サービスでログイン") || /type=["']password["']/iu.test(html)) {
      return cookieCheckResult("Fantia", "invalid_or_expired");
    }
    if (
      html.includes("あなたは18歳以上ですか？") ||
      html.includes("成人向けの画像、動画、テキストなどが表示される可能性があります")
    ) {
      return cookieCheckResult("Fantia", "verification_required");
    }
    if (/href=["']\/mypage\/dashboard["']/iu.test(html)) return cookieCheckResult("Fantia", "ready_with_cookie");
    return cookieCheckResult("Fantia", "unexpected_page");
  } catch (error) {
    return requestFailed("Fantia", error, cookie);
  }
};

export const checkConfiguredSiteCookies = async (
  configuration: Configuration,
  networkClient: CookieCheckNetworkClient,
): Promise<{ results: CookieCheckResult[] }> => {
  const [javdb, javbus, fantia] = await Promise.all([
    checkJavdbCookie(
      resolveSiteUrl(configuration.network, Website.JAVDB),
      configuration.network.javdbCookie.trim(),
      networkClient,
    ),
    checkJavbusCookie(
      resolveSiteUrl(configuration.network, Website.JAVBUS),
      configuration.network.javbusCookie.trim(),
      networkClient,
    ),
    checkFantiaCookie(configuration.network.fantiaCookie.trim(), networkClient),
  ]);

  return { results: [javdb, javbus, fantia] };
};
