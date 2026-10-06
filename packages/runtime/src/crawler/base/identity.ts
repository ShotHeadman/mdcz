import { SiteError } from "@mdcz/runtime/network";

// Aggregators list date-sequence titles without the studio; the separator and sequence width are what tell the
// studios apart (1pondo 100524_001, 10musume 100524_01, Caribbeancom 100524-001), so both must survive matching.
const DATE_SEQUENCE_NUMBER = /^(?:(1PON(?:DO)?|10MU(?:SUME)?|CARIB(?:BEANCOM)?)[\s_-]*)?(\d{6})([_-])(\d{2,3})$/u;

/** The studio-free label aggregators use for a date-sequence number, e.g. `1PON-100524_001` → `100524_001`. */
export const toDateSequenceLabel = (number: string): string | undefined => {
  const match = number.normalize("NFKC").toUpperCase().trim().match(DATE_SEQUENCE_NUMBER);
  if (!match) return undefined;
  const [, studio, date, separator, sequence] = match;
  return `${date}${studio ? (studio.startsWith("CARIB") ? "-" : "_") : separator}${sequence}`;
};

const normalizeMovieNumber = (number: string): string => {
  const dateSequence = toDateSequenceLabel(number);
  if (dateSequence) return dateSequence;
  const normalized = number
    .normalize("NFKC")
    .toUpperCase()
    .trim()
    .replace(/^FC2[\s_-]*(?:PPV[\s_-]*)?/u, "FC2-")
    .replace(/^FANTIA[\s_-]*(?=\d)/u, "");
  const code = normalized.match(/^([A-Z]+)[\s_-]*0*(\d+)$/u);
  return code ? `${code[1]}${BigInt(code[2])}` : normalized.replace(/[\s_-]+/gu, "");
};

export const movieNumbersMatch = (actual: string, expected: string): boolean =>
  Boolean(actual.trim() && expected.trim()) && normalizeMovieNumber(actual) === normalizeMovieNumber(expected);

export const verifyMovieNumber = (actual: string, expected: string): void => {
  if (!movieNumbersMatch(actual, expected)) {
    throw new SiteError("not_found", `Movie number mismatch: requested ${expected}, received ${actual || "no number"}`);
  }
};
