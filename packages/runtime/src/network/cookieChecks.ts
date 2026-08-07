import type { Configuration } from "@mdcz/shared/config";
import type { NetworkCookieCheckStatus } from "@mdcz/shared/serverDtos";
import {
  classifyJavbusPage,
  JAVBUS_HOME_URL,
  JAVBUS_REQUEST_HEADERS,
  javbusVerificationGuidance,
  toErrorMessage,
} from "../shared";

interface CookieCheckNetworkClient {
  getText(url: string, init?: { headers?: Record<string, string> }): Promise<string>;
}

export interface CookieCheckResult {
  site: string;
  valid: boolean;
  message: string;
  status: NetworkCookieCheckStatus;
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

const checkJavdbCookie = async (
  cookie: string,
  networkClient: CookieCheckNetworkClient,
): Promise<CookieCheckResult> => {
  if (!cookie) {
    return { site: "JavDB", valid: false, message: "未配置 Cookie", status: "not_configured" };
  }

  try {
    const html = await networkClient.getText("https://javdb.com/users/profile", {
      headers: { cookie },
    });
    const valid = !html.includes('href="/login"') && !html.includes("sign_in");
    return {
      site: "JavDB",
      valid,
      message: valid ? "Cookie 有效" : "Cookie 无效或已过期",
      status: valid ? "ready_with_cookie" : "invalid_or_expired",
    };
  } catch (error) {
    return {
      site: "JavDB",
      valid: false,
      message: `请求失败: ${toCookieSafeErrorMessage(error, cookie)}`,
      status: "request_failed",
    };
  }
};

const checkJavbusCookie = async (
  cookie: string,
  networkClient: CookieCheckNetworkClient,
): Promise<CookieCheckResult> => {
  try {
    const html = await networkClient.getText(JAVBUS_HOME_URL, {
      headers: {
        ...JAVBUS_REQUEST_HEADERS,
        ...(cookie ? { cookie } : {}),
      },
    });
    const page = classifyJavbusPage(html);

    if (page === "content") {
      return {
        site: "JavBus",
        valid: true,
        message: cookie ? "JavBus Cookie 有效" : "JavBus 影片页面可匿名访问，无需 Cookie",
        status: cookie ? "ready_with_cookie" : "ready_without_cookie",
      };
    }

    if (page === "verification_required") {
      return {
        site: "JavBus",
        valid: false,
        message: javbusVerificationGuidance,
        status: "verification_required",
      };
    }

    if (page === "login_wall") {
      return {
        site: "JavBus",
        valid: false,
        message: "JavBus 影片页面返回登录墙，当前 Cookie 无法访问影片内容。",
        status: "login_wall",
      };
    }

    return {
      site: "JavBus",
      valid: false,
      message: "JavBus 影片页面未返回可识别内容，请稍后重试。",
      status: "unexpected_page",
    };
  } catch (error) {
    return {
      site: "JavBus",
      valid: false,
      message: `请求失败: ${toCookieSafeErrorMessage(error, cookie)}`,
      status: "request_failed",
    };
  }
};

const checkFantiaCookie = async (
  cookie: string,
  networkClient: CookieCheckNetworkClient,
): Promise<CookieCheckResult> => {
  if (!cookie) {
    return { site: "Fantia", valid: false, message: "未配置 Cookie", status: "not_configured" };
  }

  try {
    const html = await networkClient.getText("https://fantia.jp/mypage/dashboard", {
      headers: { cookie },
    });
    if (html.includes("外部サービスでログイン") || /type=["']password["']/iu.test(html)) {
      return { site: "Fantia", valid: false, message: "Cookie 无效或已过期", status: "invalid_or_expired" };
    }

    if (
      html.includes("あなたは18歳以上ですか？") ||
      html.includes("成人向けの画像、動画、テキストなどが表示される可能性があります")
    ) {
      return {
        site: "Fantia",
        valid: false,
        message: "Fantia 页面需要完成年龄验证。请在浏览器完成验证后复制 Cookie。",
        status: "verification_required",
      };
    }

    if (/href=["']\/mypage\/dashboard["']/iu.test(html)) {
      return { site: "Fantia", valid: true, message: "Cookie 有效", status: "ready_with_cookie" };
    }

    return {
      site: "Fantia",
      valid: false,
      message: "Fantia 页面未返回可识别的登录状态，请稍后重试。",
      status: "unexpected_page",
    };
  } catch (error) {
    return {
      site: "Fantia",
      valid: false,
      message: `请求失败: ${toCookieSafeErrorMessage(error, cookie)}`,
      status: "request_failed",
    };
  }
};

export const checkConfiguredSiteCookies = async (
  configuration: Configuration,
  networkClient: CookieCheckNetworkClient,
): Promise<{ results: CookieCheckResult[] }> => {
  const [javdb, javbus, fantia] = await Promise.all([
    checkJavdbCookie(configuration.network.javdbCookie.trim(), networkClient),
    checkJavbusCookie(configuration.network.javbusCookie.trim(), networkClient),
    checkFantiaCookie(configuration.network.fantiaCookie.trim(), networkClient),
  ]);

  return { results: [javdb, javbus, fantia] };
};
