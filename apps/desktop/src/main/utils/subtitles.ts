import type { FileInfo, SubtitleTag } from "@mdcz/shared/types";

export const SUBTITLE_EXTENSIONS = new Set([
  ".smi",
  ".srt",
  ".idx",
  ".sub",
  ".sup",
  ".psb",
  ".ssa",
  ".ass",
  ".usf",
  ".xss",
  ".ssf",
  ".rt",
  ".lrc",
  ".sbv",
  ".vtt",
  ".ttml",
]);

export const CHINESE_SUBTITLE_STRONG_HINTS = ["中文字幕", "中字版", "简中字幕", "简中", "中字"] as const;
export const CHINESE_SUBTITLE_FILENAME_TOKEN_HINTS = ["UC", "C", "CHS", "中文"] as const;
const CHINESE_SUBTITLE_SIDECAR_TOKEN_HINTS = new Set(["zh", "cn", "chs", "sc", "uc", "c"]);
const CHINESE_SUBTITLE_SUFFIX_TEXT_HINTS = [...CHINESE_SUBTITLE_STRONG_HINTS, "中文"] as const;
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
const EMBEDDED_SUBTITLE_PATTERN = new RegExp(joinRegexAlternation(CHINESE_SUBTITLE_STRONG_HINTS), "u");

export const normalizeSubtitleText = (value: string): string => value.normalize("NFC");

export const detectChineseSubtitleTagInFileName = (value: string): SubtitleTag | undefined => {
  const normalized = normalizeSubtitleText(value);
  if (FILENAME_SUBTITLE_PATTERN.test(normalized) || EMBEDDED_SUBTITLE_PATTERN.test(normalized)) {
    return "中文字幕";
  }

  return undefined;
};

export const detectSubtitleTagFromSidecarSuffix = (suffix: string): SubtitleTag => {
  if (!suffix.trim()) {
    return "字幕";
  }

  const normalized = normalizeSubtitleText(suffix);
  const tokens = normalized
    .toLowerCase()
    .split(/[-_.\s()[\]{}【】（）]+/u)
    .filter((token) => token.length > 0);
  if (tokens.some((token) => CHINESE_SUBTITLE_SIDECAR_TOKEN_HINTS.has(token))) {
    return "中文字幕";
  }

  if (CHINESE_SUBTITLE_SUFFIX_TEXT_HINTS.some((hint) => normalized.includes(hint))) {
    return "中文字幕";
  }

  return "字幕";
};

export const preferSubtitleTag = (...tags: Array<SubtitleTag | undefined>): SubtitleTag | undefined => {
  if (tags.includes("中文字幕")) {
    return "中文字幕";
  }

  if (tags.includes("字幕")) {
    return "字幕";
  }

  return undefined;
};

export const resolveFileInfoSubtitleTag = (
  fileInfo: Pick<FileInfo, "isSubtitled" | "subtitleTag"> | undefined,
): SubtitleTag | undefined => {
  if (!fileInfo) {
    return undefined;
  }

  if (fileInfo.subtitleTag) {
    return fileInfo.subtitleTag;
  }

  return fileInfo.isSubtitled ? "字幕" : undefined;
};
