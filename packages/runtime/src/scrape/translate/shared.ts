import * as OpenCC from "opencc-js";
import type { LanguageTarget } from "./types";

export const normalizeNewlines = (value: string): string => value.replace(/\r\n?/gu, "\n");

export const normalizeTermKey = (value: string): string => {
  return value.normalize("NFKC").trim().toLowerCase();
};

const toTraditional = OpenCC.Converter({ from: "cn", to: "tw" });
const toSimplified = OpenCC.Converter({ from: "tw", to: "cn" });

export const ensureTargetChinese = (text: string, target: LanguageTarget): string =>
  target === "zh_tw" ? toTraditional(text) : toSimplified(text);

export const getTargetLanguageLabel = (target: LanguageTarget): string => {
  if (target === "zh_tw") {
    return "繁体中文";
  }
  return "简体中文";
};
