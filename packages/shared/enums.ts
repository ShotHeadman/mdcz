export enum Website {
  DAHLIA = "dahlia",
  DMM = "dmm",
  DMM_TV = "dmm_tv",
  FALENO = "faleno",
  FC2 = "fc2",
  FC2HUB = "fc2hub",
  JAV321 = "jav321",
  JAVBUS = "javbus",
  JAVDB = "javdb",
  KM_PRODUCE = "km_produce",
  MGSTAGE = "mgstage",
  PRESTIGE = "prestige",
  AVBASE = "avbase",
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
}

export enum UiLanguage {
  ZH_CN = "zh-CN",
  ZH_TW = "zh-TW",
  JA_JP = "ja-JP",
  EN_US = "en-US",
}

export const TRANSLATION_TARGET_OPTIONS = [UiLanguage.ZH_CN, UiLanguage.ZH_TW] as const;

export type TranslationTarget = (typeof TRANSLATION_TARGET_OPTIONS)[number];

export enum ThemeMode {
  SYSTEM = "system",
  LIGHT = "light",
  DARK = "dark",
}
