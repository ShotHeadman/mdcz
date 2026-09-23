import { CHINESE_SUBTITLE_STRONG_HINTS, normalizeSubtitleText } from "@mdcz/shared/subtitleFilename";
import type { FileInfo, SubtitleTag } from "@mdcz/shared/types";

export {
  CHINESE_SUBTITLE_FILENAME_TOKEN_HINTS,
  CHINESE_SUBTITLE_STRONG_HINTS,
  detectChineseSubtitleTagInFileName,
  normalizeSubtitleText,
} from "@mdcz/shared/subtitleFilename";

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

const CHINESE_SUBTITLE_SIDECAR_TOKEN_HINTS = new Set(["zh", "cn", "chs", "sc", "uc", "c"]);
const CHINESE_SUBTITLE_SUFFIX_TEXT_HINTS = [...CHINESE_SUBTITLE_STRONG_HINTS, "中文"] as const;

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
