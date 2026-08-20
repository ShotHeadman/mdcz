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
}
export const FC2_SITE_WHITELIST = new Set<Website>([Website.FC2, Website.FC2HUB, Website.PPVDATABANK, Website.JAVDB]);
export const FC2_ONLY_SITES = new Set<Website>([Website.FC2, Website.FC2HUB, Website.PPVDATABANK]);
export const DMM_FAMILY_SITES = new Set<Website>([Website.DMM, Website.DMM_TV]);

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
