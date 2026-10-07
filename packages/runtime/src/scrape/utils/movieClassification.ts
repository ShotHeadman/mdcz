import type { CrawlerData, FileInfo, NfoLocalState } from "@mdcz/shared/types";

/** What kind of catalog a number belongs to; crawlers declare which kinds they serve. */
export type ContentType = "censored" | "uncensored" | "fc2";

const FC2_NUMBER_PATTERN = /^FC2[-_\s]*(?:PPV[-_\s]*)?\d+/iu;
const UNCENSORED_NUMBER_PATTERNS = [
  /^HEYZO-\d+/iu,
  /^(?:1PON(?:DO)?|10MU(?:SUME)?|CARIB(?:BEANCOM)?|PACO|MURA|KIN8)[-_]?\d+/iu,
  /^\d{6}[-_]\d{2,3}$/u,
];

export const classifyNumber = (number: string): ContentType => {
  const normalized = number.trim();
  if (FC2_NUMBER_PATTERN.test(normalized)) return "fc2";
  return UNCENSORED_NUMBER_PATTERNS.some((pattern) => pattern.test(normalized)) ? "uncensored" : "censored";
};

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

export const isLikelyUncensoredNumber = (number: string): boolean => classifyNumber(number) !== "censored";

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

  if (fileInfo.filenameUncensoredChoice) {
    uncensored = true;
    umr = fileInfo.filenameUncensoredChoice === "umr";
    leak = fileInfo.filenameUncensoredChoice === "leak";
  }

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
