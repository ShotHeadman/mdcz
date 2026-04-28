import type { CrawlerData, FileInfo, NfoLocalState } from "@mdcz/shared/types";

export const UNCENSORED_NUMBER_PATTERNS = [
  /^FC2-\d+/iu,
  /^HEYZO-\d+/iu,
  /^(?:1PON|10MU|CARIB|PACO|MURA|KIN8)[-_]?\d+/iu,
];

export const UMR_HINTS = ["umr", "破解", "universal media record"];
export const LEAK_HINTS = ["流出", "leak"];

export interface MovieClassification {
  subtitled: boolean;
  uncensored: boolean;
  umr: boolean;
  leak: boolean;
}

export const includesHint = (source: string, hints: string[]): boolean => {
  const text = source.toLowerCase();
  return hints.some((hint) => text.includes(hint));
};

export const isLikelyUncensoredNumber = (number: string): boolean => {
  const normalized = number.trim().toUpperCase();
  if (!normalized) {
    return false;
  }

  return UNCENSORED_NUMBER_PATTERNS.some((pattern) => pattern.test(normalized));
};

export const classifyMovie = (
  fileInfo: FileInfo,
  data: CrawlerData,
  localState?: NfoLocalState,
): MovieClassification => {
  const textProbe = [data.title, data.title_zh, ...(data.genres ?? [])]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  let umr = includesHint(textProbe, UMR_HINTS);
  let leak = includesHint(textProbe, LEAK_HINTS);
  let uncensored =
    isLikelyUncensoredNumber(data.number || fileInfo.number) || Boolean(fileInfo.isUncensored) || umr || leak;

  if (localState?.uncensoredChoice) {
    uncensored = true;
    umr = localState.uncensoredChoice === "umr";
    leak = localState.uncensoredChoice === "leak";
  }

  return {
    subtitled: fileInfo.isSubtitled,
    uncensored,
    umr,
    leak,
  };
};
