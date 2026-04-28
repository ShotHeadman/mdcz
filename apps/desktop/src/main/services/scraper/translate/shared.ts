import { convertToSimplified, convertToTraditional, detectLanguage } from "@main/utils/language";
import type { LanguageTarget } from "./types";

export const normalizeNewlines = (value: string): string => value.replace(/\r\n?/gu, "\n");

export const normalizeTermKey = (value: string): string => {
  return value.normalize("NFKC").trim().toLowerCase();
};

export const ensureTargetChinese = (text: string, target: LanguageTarget): string => {
  if (target === "zh_tw") {
    return convertToTraditional(text);
  }

  return convertToSimplified(text);
};

export const getTargetLanguageLabel = (target: LanguageTarget): string => {
  if (target === "zh_tw") {
    return "繁体中文";
  }
  return "简体中文";
};

export const toTranslatedFieldValue = (value: string): string | undefined => {
  const detected = detectLanguage(value);
  return detected === "zh_cn" || detected === "zh_tw" ? value : undefined;
};
