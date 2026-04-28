import { normalizeCode, normalizeText } from "@main/utils/normalization";
import { uniqueStrings } from "@main/utils/strings";
import type { CheerioAPI } from "cheerio";

import { extractList, extractText } from "../base/parser";

const buildLabelSelectors = (label: string): string[] => {
  return [
    `th:contains('${label}') + td`,
    `td:contains('${label}') + td`,
    `span:contains('${label}') + p`,
    `span:contains('${label}') + *`,
    `strong:contains('${label}') + a`,
    `strong:contains('${label}') + *`,
  ];
};

export const toAbsoluteUrl = (baseUrl: string, value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  if (value.startsWith("http")) {
    return value;
  }

  if (value.startsWith("//")) {
    return `https:${value}`;
  }

  return new URL(value, baseUrl).href;
};

const normalizeSearchResultHref = (href: string): string => {
  const hrefWithoutQuery = href.split(/[?#]/u)[0] ?? href;
  return normalizeCode(hrefWithoutQuery);
};

const stripNumericPadding = (value: string): string =>
  value.replace(/\d+/gu, (digits) => digits.replace(/^0+(?=\d)/u, ""));

type CheerioInput = Parameters<CheerioAPI>[0];

const findLabeledParent = (
  $: CheerioAPI,
  labelSelector: string,
  labels: string[],
): { element: CheerioInput; text: string } | undefined => {
  const candidates = $(labelSelector)
    .toArray()
    .map((element: CheerioInput) => ({
      element,
      text: $(element).text().trim(),
    }));

  return candidates.find((entry) => labels.some((label) => entry.text.includes(label)));
};

/**
 * Search result URLs often encode the same number with separator or zero-padding variants.
 * Prefer the first href whose normalized form matches the expected number.
 * If nothing matches, return null instead of guessing from an unrelated candidate.
 */
export const pickSearchResultDetailUrl = (
  baseUrl: string,
  candidateHrefs: Array<string | undefined>,
  expectedNumber: string,
): string | null => {
  const candidates = candidateHrefs.filter((href): href is string => typeof href === "string" && href.length > 0);
  const normalizedExpected = normalizeCode(expectedNumber);

  if (!normalizedExpected) {
    return candidates[0] ? (toAbsoluteUrl(baseUrl, candidates[0]) ?? null) : null;
  }

  const normalizedExpectedWithoutPadding = stripNumericPadding(normalizedExpected);
  for (const href of candidates) {
    const normalizedHref = normalizeSearchResultHref(href);
    if (
      normalizedHref.includes(normalizedExpected) ||
      stripNumericPadding(normalizedHref).includes(normalizedExpectedWithoutPadding)
    ) {
      return toAbsoluteUrl(baseUrl, href) ?? null;
    }
  }

  return null;
};

export const extractParentTextByLabelSelector = (
  $: CheerioAPI,
  labelSelector: string,
  labels: string[],
): string | undefined => {
  const labeledParent = findLabeledParent($, labelSelector, labels);
  if (!labeledParent) {
    return undefined;
  }

  const clone = $(labeledParent.element).parent().clone();
  clone.find(labelSelector).remove();
  const text = normalizeText(clone.text());
  return text || undefined;
};

export const extractParentLinksByLabelSelector = ($: CheerioAPI, labelSelector: string, labels: string[]): string[] => {
  const labeledParent = findLabeledParent($, labelSelector, labels);
  if (!labeledParent) {
    return [];
  }

  return uniqueStrings(
    $(labeledParent.element)
      .parent()
      .find("a")
      .toArray()
      .map((element: CheerioInput) => normalizeText($(element).text()))
      .filter((value: string) => value.length > 0),
  );
};

export const normalizeFc2Number = (value: string): string => {
  return value
    .toUpperCase()
    .replaceAll("FC2PPV", "")
    .replaceAll("FC2-PPV-", "")
    .replaceAll("FC2-", "")
    .replaceAll("-", "")
    .trim();
};

export const parseClockDurationToSeconds = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const matched = normalizeText(value).match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/u);
  if (!matched) {
    return undefined;
  }

  const hours = Number.parseInt(matched[1] ?? "0", 10);
  const minutes = Number.parseInt(matched[2], 10);
  const seconds = Number.parseInt(matched[3], 10);
  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? total : undefined;
};

export const extractByLabels = ($: CheerioAPI, labels: string[]): string | undefined => {
  for (const label of labels) {
    for (const selector of buildLabelSelectors(label)) {
      const value = extractText($, selector);
      if (value) {
        return value;
      }
    }
  }

  return undefined;
};

export const extractByLabel = ($: CheerioAPI, label: string): string | undefined => {
  return extractByLabels($, [label]);
};

export const extractLinksByLabels = ($: CheerioAPI, labels: string[]): string[] => {
  const result = new Set<string>();
  for (const label of labels) {
    for (const selector of buildLabelSelectors(label)) {
      const list = extractList($, `${selector} a`);
      list.forEach((item) => {
        result.add(item);
      });
    }
  }

  return Array.from(result);
};

export const normalizeCsv = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );
};
