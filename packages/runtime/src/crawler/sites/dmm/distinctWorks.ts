import { SiteError } from "@mdcz/runtime/network";
import type { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";

export interface DmmWork {
  data: CrawlerData;
  detailUrl: string;
}

/**
 * Representations of one work (digital `1sw00130`, mono `sw00130`, TV `sw130`) share a label stem and sequence;
 * a different stem (`h_113sw00130`) is another supplier's listing that merely reuses the number.
 */
export const parseDmmContentId = (contentId: string): { stem: string; sequence: string } | undefined => {
  const match = contentId
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, "")
    .match(/^\d*([a-z][a-z0-9]*?)(\d+)$/u);
  return match ? { stem: match[1], sequence: BigInt(match[2]).toString() } : undefined;
};

export const dmmWorkKey = (contentId: string): string | undefined => {
  const parsed = parseDmmContentId(contentId);
  return parsed && `${parsed.stem}-${parsed.sequence}`;
};

export const dmmDetailUrlWorkKey = (detailUrl: string): string | undefined => {
  const cid = detailUrl.match(/\/cid=([^/?&#]+)/iu)?.[1];
  if (cid) return dmmWorkKey(cid);
  try {
    const { searchParams } = new URL(detailUrl);
    const contentId = searchParams.get("id") ?? searchParams.get("content");
    return contentId ? dmmWorkKey(contentId) : undefined;
  } catch {
    return undefined;
  }
};

const compact = (value: string | undefined): string =>
  value?.normalize("NFKC").replace(/\s+/gu, "").toLowerCase() ?? "";

export const isSameMaker = (left: string | undefined, right: string | undefined): boolean =>
  compact(left) === compact(right);

// A re-release by the same maker carries the same content, so only another maker (or, without makers, another title)
// makes a second listing a different work.
const isSameWork = (left: CrawlerData, right: CrawlerData): boolean =>
  isSameMaker(left.studio, right.studio) &&
  (compact(left.studio) !== "" || compact(left.title) === compact(right.title));

/** Adds a verified listing unless a listed work is already the same one; reports whether it was added. */
export const addDistinctWork = (works: DmmWork[], work: DmmWork): boolean => {
  if (works.some((listed) => isSameWork(listed.data, work.data))) return false;
  works.push(work);
  return true;
};

export const ambiguousWorksError = (site: Website, number: string, works: readonly DmmWork[]): SiteError =>
  new SiteError("ambiguous", `${site} lists ${works.length} works under ${number}`, {
    candidates: works.map(({ data, detailUrl }) => ({
      site,
      detailUrl,
      title: data.title,
      releaseDate: data.release_date,
      studio: data.studio,
      coverUrl: data.thumb_url,
    })),
  });
