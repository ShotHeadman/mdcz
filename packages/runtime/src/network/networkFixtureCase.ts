import type { PrepareScrapeItem } from "../scrape/ScrapeRunner";

// Parts, STRM files, and resolution versions of one movie share the recording of its number.
export const fixtureCaseIdFromNumber = (number: string): string => {
  const caseId = number
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/gu, "-")
    .replaceAll(/^[._-]+|[._-]+$/gu, "")
    .replaceAll(/-{2,}/gu, "-");
  if (!caseId) throw new Error(`Cannot derive fixture caseId from number "${number}"`);
  return caseId;
};

export const attachNetworkFixtureCaseId: PrepareScrapeItem = (item) => ({
  ...item,
  caseId: fixtureCaseIdFromNumber(item.fileInfo.number),
});
