import * as OpenCC from "opencc-js";

export type DetectedLanguage = "jp" | "zh_cn" | "zh_tw" | "other";

const KANA_PATTERN = /[\u3040-\u30ff]/u;
const HAN_PATTERN = /[\u3400-\u9fff]/u;

const toTraditional = OpenCC.Converter({ from: "cn", to: "tw" });
const toSimplified = OpenCC.Converter({ from: "tw", to: "cn" });

export const isJapanese = (text: string): boolean => KANA_PATTERN.test(text);

export const isChinese = (text: string): boolean => HAN_PATTERN.test(text) && !isJapanese(text);

export const detectLanguage = (text: string): DetectedLanguage => {
  if (!text.trim()) {
    return "other";
  }

  if (isJapanese(text)) {
    return "jp";
  }

  if (isChinese(text)) {
    const simplified = toSimplified(text);
    const traditional = toTraditional(text);

    if (traditional === text && simplified !== text) {
      return "zh_tw";
    }
    return "zh_cn";
  }

  return "other";
};

export const convertToSimplified = (text: string): string => toSimplified(text);

export const convertToTraditional = (text: string): string => toTraditional(text);
