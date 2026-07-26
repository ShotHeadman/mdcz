export const JAVBUS_BASE_URL = "https://www.javbus.com";
export const JAVBUS_HOME_URL = `${JAVBUS_BASE_URL}/`;
export const JAVBUS_REQUEST_HEADERS = {
  referer: JAVBUS_HOME_URL,
  "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6",
} as const;

export type JavbusPageClassification = "content" | "verification_required" | "login_wall" | "unknown";

// Specific markers observed on the age-confirmation interstitial and the
// region driving-quiz page; safe to match even when content markers coexist
// (the age modal can overlay a content page).
const JAVBUS_VERIFICATION_PATTERNS = [
  /Age Verification JavBus/iu,
  /id=["']ageVerify["']/iu,
  /你是否已經成年/iu,
  /你是否已经成年/iu,
  /(?:駕駛|驾驶)[\s\S]{0,80}(?:考試|考试|題|题|驗證|验证)/iu,
];

// Generic English wording; too loose to trust on a page that already shows
// film content, so only consulted after the content check fails.
const JAVBUS_GENERIC_VERIFICATION_PATTERNS = [
  /(?:region|country|area)[\s\S]{0,80}(?:verification|verify|question|quiz)/iu,
  /(?:verification|verify|question|quiz)[\s\S]{0,80}(?:region|country|area)/iu,
];

const JAVBUS_CONTENT_PATTERNS = [/class=["'][^"']*\bmovie-box\b/iu, /id=["']waterfall["']/iu];

const JAVBUS_LOGIN_PATTERNS = [/\blog[ _-]?in\b/iu, /\bsign[ _-]?in\b/iu, /登入/iu, /登录/iu];

export const classifyJavbusPage = (html: string): JavbusPageClassification => {
  if (JAVBUS_VERIFICATION_PATTERNS.some((pattern) => pattern.test(html))) {
    return "verification_required";
  }

  if (JAVBUS_CONTENT_PATTERNS.some((pattern) => pattern.test(html))) {
    return "content";
  }

  if (JAVBUS_GENERIC_VERIFICATION_PATTERNS.some((pattern) => pattern.test(html))) {
    return "verification_required";
  }

  const hasLoginKeyword = JAVBUS_LOGIN_PATTERNS.some((pattern) => pattern.test(html));
  const hasPasswordField = /type=["']password["']/iu.test(html);
  if (hasLoginKeyword && hasPasswordField) {
    return "login_wall";
  }

  return "unknown";
};

export const javbusVerificationGuidance = "JavBus 影片页面需要完成年龄/地区验证。请在浏览器完成验证后复制 Cookie。";

// The English prefixes ("region blocked" / "login wall") are load-bearing:
// BaseCrawler.toFailureReason derives failureReason by keyword-matching the
// thrown message.
export const javbusBlockedPageMessage = (page: JavbusPageClassification): string | null => {
  if (page === "verification_required") {
    return `JavBus region blocked by age/region verification. ${javbusVerificationGuidance} 论坛账号注册不能解决此问题。`;
  }

  if (page === "login_wall") {
    return "JavBus login wall detected; the current Cookie cannot access film content.";
  }

  return null;
};
