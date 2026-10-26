export enum Website {
  DAHLIA = "dahlia",
  DMM = "dmm",
  DMM_TV = "dmm_tv",
  FALENO = "faleno",
  FANTIA = "fantia",
  FC2 = "fc2",
  FC2HUB = "fc2hub",
  H0930 = "h0930",
  H4610 = "h4610",
  PPVDATABANK = "ppvdatabank",
  JAV321 = "jav321",
  JAVBUS = "javbus",
  JAVDB = "javdb",
  KINGDOM = "kingdom",
  KM_PRODUCE = "km_produce",
  MGSTAGE = "mgstage",
  PRESTIGE = "prestige",
  R18_DEV = "r18_dev",
  SOKMIL = "sokmil",
  AVBASE = "avbase",
  AVWIKIDB = "avwikidb",
  OFFICIAL = "official",
  ONEPONDO = "1pondo",
  TENMUSUME = "10musume",
  CARIBBEANCOM = "caribbeancom",
  HEYZO = "heyzo",
}

export enum ProxyType {
  NONE = "none",
  HTTP = "http",
  HTTPS = "https",
  SOCKS5 = "socks5",
}

export enum TranslateEngine {
  OPENAI = "openai",
  GOOGLE = "google",
  DEEPL = "deepl",
  BAIDU = "baidu",
}

export enum UiLanguage {
  ZH_CN = "zh-CN",
  ZH_TW = "zh-TW",
  JA_JP = "ja-JP",
  EN_US = "en-US",
}

/** The interface languages. MDCz's own labels in what it writes for the user, such as actor bios, follow it. */
export const UI_LOCALES = ["zh-CN", "en-US"] as const;

export type UiLocale = (typeof UI_LOCALES)[number];

export const TRANSLATION_TARGET_OPTIONS = [UiLanguage.ZH_CN, UiLanguage.ZH_TW] as const;

export type TranslationTarget = (typeof TRANSLATION_TARGET_OPTIONS)[number];

export enum ThemeMode {
  SYSTEM = "system",
  LIGHT = "light",
  DARK = "dark",
}
