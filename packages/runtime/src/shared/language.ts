export type DetectedLanguage = "jp" | "zh" | "other";

const KANA_PATTERN = /[぀-ヿ]/u;
const HAN_PATTERN = /[㐀-鿿]/u;

export const detectLanguage = (text: string): DetectedLanguage => {
  if (KANA_PATTERN.test(text)) return "jp";
  if (HAN_PATTERN.test(text)) return "zh";
  return "other";
};
