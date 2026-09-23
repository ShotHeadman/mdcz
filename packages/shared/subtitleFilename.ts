import type { SubtitleTag } from "./types";

export const CHINESE_SUBTITLE_STRONG_HINTS = ["中文字幕", "中字版", "简中字幕", "简中", "中字"] as const;
export const CHINESE_SUBTITLE_FILENAME_TOKEN_HINTS = ["UC", "CHS", "CH", "C", "中文"] as const;

const FILENAME_DELIMITER_SOURCE = String.raw`[-_.\s\[\](){}【】（）]`;
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const joinRegexAlternation = (values: readonly string[]): string => values.map(escapeRegex).join("|");
const FILENAME_SUBTITLE_TOKEN_SOURCE = joinRegexAlternation([
  ...CHINESE_SUBTITLE_FILENAME_TOKEN_HINTS,
  ...CHINESE_SUBTITLE_STRONG_HINTS,
]);
const FILENAME_SUBTITLE_PATTERN = new RegExp(
  `(?:^|${FILENAME_DELIMITER_SOURCE})(?:${FILENAME_SUBTITLE_TOKEN_SOURCE})(?:$|${FILENAME_DELIMITER_SOURCE})`,
  "iu",
);
const ATTACHED_CHINESE_SUBTITLE_SUFFIX_PATTERN = /(?<=\d)(?:CHS|CH)$/iu;
const EMBEDDED_SUBTITLE_PATTERN = new RegExp(joinRegexAlternation(CHINESE_SUBTITLE_STRONG_HINTS), "u");

export const normalizeSubtitleText = (value: string): string => value.normalize("NFC");

export const detectChineseSubtitleTagInFileName = (value: string): SubtitleTag | undefined => {
  const normalized = normalizeSubtitleText(value);
  if (
    FILENAME_SUBTITLE_PATTERN.test(normalized) ||
    ATTACHED_CHINESE_SUBTITLE_SUFFIX_PATTERN.test(normalized) ||
    EMBEDDED_SUBTITLE_PATTERN.test(normalized)
  ) {
    return "中文字幕";
  }
  return undefined;
};
