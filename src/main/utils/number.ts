import { basename, extname } from "node:path";

import {
  CHINESE_SUBTITLE_FILENAME_TOKEN_HINTS,
  CHINESE_SUBTITLE_STRONG_HINTS,
  detectChineseSubtitleTagInFileName,
} from "@main/utils/subtitles";
import type { FileInfo } from "@shared/types";

const FILENAME_DELIMITER_SOURCE = String.raw`[-_.\s\[\](){}【】（）]`;

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const joinRegexAlternation = (values: readonly string[]): string => values.map(escapeRegex).join("|");

const SUBTITLE_TOKEN_SOURCE = joinRegexAlternation([
  ...CHINESE_SUBTITLE_FILENAME_TOKEN_HINTS,
  ...CHINESE_SUBTITLE_STRONG_HINTS,
]);
const UNCENSORED_PATTERN = new RegExp(
  `(?:^|${FILENAME_DELIMITER_SOURCE})(?:UC|U)(?:$|${FILENAME_DELIMITER_SOURCE})`,
  "iu",
);
const RESOLUTION_PATTERNS = [/\b8K\b/iu, /\b4K\b/iu, /\b2160P\b/iu, /\b1080P\b/iu, /\b720P\b/iu];
const PART_PATTERN = /([-_.\s](?:CD|PART|EP)[-_\s]?(\d{1,2}))(?=$|[-_.\s])/giu;
const FC2_JP_PART_PATTERN = /([-_.\s](前番|前編|後番|後編))(?=$|[-_.\s])/gu;
const TRAILING_SUBTITLE_PATTERN = new RegExp(`${FILENAME_DELIMITER_SOURCE}(?:${SUBTITLE_TOKEN_SOURCE})$`, "iu");
const TRAILING_UNCENSORED_PATTERN = /[-_.\s]U$/iu;
const TRAILING_PART_PATTERN = /[-_.\s](?:CD|PART|EP)[-_\s]?\d{1,2}$/iu;
const TRAILING_FC2_JP_PART_PATTERN = /[-_.\s](?:前番|前編|後番|後編)$/u;
const TRAILING_BARE_PART_PATTERN = /[-_.\s][1-9]$/u;

const SHORT_TOKEN_PATTERNS = [
  "4K",
  "4KS",
  "8K",
  "2160P",
  "1080P",
  "720P",
  "HD",
  "HEVC",
  "H264",
  "H265",
  "X264",
  "X265",
  "AAC",
  "DVD",
  "FULL",
] as const;

const stripTrailingTokens = (value: string, options: { stripBarePart: boolean }): string => {
  let current = value;

  while (true) {
    const next = current
      .replace(TRAILING_SUBTITLE_PATTERN, "")
      .replace(TRAILING_UNCENSORED_PATTERN, "")
      .replace(TRAILING_PART_PATTERN, "")
      .replace(TRAILING_FC2_JP_PART_PATTERN, "");
    const stripped = options.stripBarePart ? next.replace(TRAILING_BARE_PART_PATTERN, "") : next;

    if (stripped === current) {
      return stripped;
    }

    current = stripped;
  }
};

const normalizeName = (rawName: string, escapeStrings: string[] = [], options: { stripBarePart: boolean }): string => {
  let normalized = rawName.normalize("NFC").toUpperCase();

  for (const token of escapeStrings) {
    if (!token.trim()) {
      continue;
    }
    normalized = normalized.replaceAll(token.toUpperCase(), "");
  }

  for (const token of SHORT_TOKEN_PATTERNS) {
    normalized = normalized.replace(new RegExp(`[-_.\\s\\[]${token}[-_.\\s\\]]`, "giu"), "-");
  }

  normalized = normalized
    .replace(/FC2[-_ ]?PPV/giu, "FC2-")
    .replace(/GACHIPPV/giu, "GACHI")
    .replace(/--+/gu, "-")
    .replace(/\d{4}[-_.]\d{1,2}[-_.]\d{1,2}/gu, "")
    .replace(/[-[]\d{2}[-_.]\d{2}[-_.]\d{2}\]?/gu, "")
    .replace(/[-_.\s][A-Z0-9]\.$/gu, "");

  normalized = stripTrailingTokens(normalized, options)
    .replace(/[-_.\s]+/gu, "-")
    .replace(/^[-_.\s]+|[-_.\s]+$/gu, "");

  return normalized;
};

const normalizeRawName = (rawName: string, escapeStrings: string[] = []): string =>
  normalizeName(rawName, escapeStrings, { stripBarePart: true });

const normalizePartProbeName = (rawName: string, escapeStrings: string[] = []): string =>
  normalizeName(rawName, escapeStrings, { stripBarePart: false });

const normalizeNumber = (value: string): string => {
  return value
    .replace(/FC-/u, "FC2-")
    .replace(/--+/gu, "-")
    .replace(/^[-_.\s]+|[-_.\s]+$/gu, "");
};

export const extractNumber = (fileName: string, escapeStrings: string[] = []): string => {
  const normalized = normalizeRawName(fileName, escapeStrings);

  const orderedPatterns: RegExp[] = [
    /(FC2-\d{5,})/iu,
    /(FC2\d{5,})/iu,
    /(HEYZO-\d{3,})/iu,
    /(HEYZO\d{3,})/iu,
    /(TH101-\d{3,}-\d{5,})/iu,
    /(T28-?\d{3,})/iu,
    /(S2M[BD]*-\d{3,})/iu,
    /(MCB3D[BD]*-\d{2,})/iu,
    /(KIN8(?:TENGOKU)?-?\d{3,})/iu,
    /(CW3D2D?BD-?\d{2,})/iu,
    /(MMR-?[A-Z]{2,}-?\d+[A-Z]*)/iu,
    /(XXX-AV-\d{4,})/iu,
    /(MKY-[A-Z]+-\d{3,})/iu,
    /([A-Z]{2,})00(\d{3})/iu,
    /(\d{2,}[A-Z]{2,}-\d{2,}[A-Z]?)/iu,
    /([A-Z]{2,}-\d{2,}[A-Z]?)/iu,
    /([A-Z]+-[A-Z]\d+)/iu,
    /(\d{2,}[-_]\d{2,})/iu,
    /(\d{3,}-[A-Z]{3,})/iu,
    /(?:^|[^A-Z])(N\d{4})(?:[^A-Z]|$)/iu,
    /H_\d{3,}([A-Z]{2,})(\d{2,})/iu,
    /([A-Z]{3,}).*?(\d{2,})/iu,
    /([A-Z]{2,}).*?(\d{3,})/iu,
  ];

  for (const pattern of orderedPatterns) {
    const match = normalized.match(pattern);
    if (!match) {
      continue;
    }

    if (pattern.source === "([A-Z]{2,})00(\\d{3})") {
      return normalizeNumber(`${match[1]}-${match[2]}`);
    }

    if (pattern.source === "H_\\d{3,}([A-Z]{2,})(\\d{2,})") {
      return normalizeNumber(`${match[1]}-${match[2]}`);
    }

    if (pattern.source === "([A-Z]{3,}).*?(\\d{2,})" || pattern.source === "([A-Z]{2,}).*?(\\d{3,})") {
      return normalizeNumber(`${match[1]}-${match[2]}`);
    }

    return normalizeNumber(match[1] ?? match[0]);
  }

  return normalizeNumber(normalized);
};

const detectNamedPart = (stem: string, number: string): FileInfo["part"] | undefined => {
  const keywordMatches = Array.from(stem.matchAll(PART_PATTERN));
  const keywordMatch = keywordMatches.at(-1);
  if (keywordMatch) {
    return {
      number: Number.parseInt(keywordMatch[2], 10),
      suffix: keywordMatch[1],
    };
  }

  if (!number.toUpperCase().startsWith("FC2-")) {
    return undefined;
  }

  const jpMatches = Array.from(stem.matchAll(FC2_JP_PART_PATTERN));
  const jpMatch = jpMatches.at(-1);
  if (!jpMatch) {
    return undefined;
  }

  const token = jpMatch[2];
  return {
    number: token === "前番" || token === "前編" ? 1 : 2,
    suffix: jpMatch[1],
  };
};

const TRAILING_RAW_BARE_PART_PATTERN = new RegExp(
  String.raw`([-_.\s][1-9])(?:${FILENAME_DELIMITER_SOURCE}(?:${joinRegexAlternation(["U", ...CHINESE_SUBTITLE_FILENAME_TOKEN_HINTS, ...CHINESE_SUBTITLE_STRONG_HINTS])}))*$`,
  "iu",
);

const detectBareNumericPart = (
  stem: string,
  number: string,
  escapeStrings: string[] = [],
): FileInfo["part"] | undefined => {
  const normalizedProbe = normalizePartProbeName(stem, escapeStrings);
  const normalizedNumber = number.trim().toUpperCase();
  if (!normalizedNumber) {
    return undefined;
  }

  const numberIndex = normalizedProbe.indexOf(normalizedNumber);
  if (numberIndex < 0) {
    return undefined;
  }

  const remainder = normalizedProbe.slice(numberIndex + normalizedNumber.length);
  const remainderMatch = remainder.match(/^-([1-9])$/u);
  if (!remainderMatch) {
    return undefined;
  }

  const rawSuffixMatch = stem.match(TRAILING_RAW_BARE_PART_PATTERN);
  if (!rawSuffixMatch) {
    return undefined;
  }

  return {
    number: Number.parseInt(remainderMatch[1], 10),
    suffix: rawSuffixMatch[1],
  };
};

export const parseFileInfo = (filePath: string, escapeStrings: string[] = []): FileInfo => {
  const extension = extname(filePath);
  const stem = basename(filePath, extension);
  const normalizedStem = stem.normalize("NFC");
  const normalizedUpper = normalizedStem.toUpperCase();

  const subtitleTag = detectChineseSubtitleTagInFileName(normalizedStem);
  const uncensoredMatch = normalizedUpper.match(UNCENSORED_PATTERN);
  const resolutionMatch = RESOLUTION_PATTERNS.map((pattern) => normalizedUpper.match(pattern)).find(Boolean);
  const number = extractNumber(normalizedStem, escapeStrings);
  const part = detectNamedPart(normalizedStem, number) ?? detectBareNumericPart(normalizedStem, number, escapeStrings);

  return {
    filePath,
    fileName: normalizedStem,
    extension,
    number,
    isSubtitled: Boolean(subtitleTag),
    subtitleTag,
    isUncensored: Boolean(uncensoredMatch),
    resolution: resolutionMatch?.[0],
    part,
  };
};
