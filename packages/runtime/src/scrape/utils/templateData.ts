import type { Configuration } from "@mdcz/shared/config";
import type { CrawlerData } from "@mdcz/shared/types";

export type MetadataNaming = Pick<
  Configuration["naming"],
  "actorNameMax" | "actorNameMore" | "actorFallbackToStudio" | "releaseRule"
>;

const FC2_NUMBER_PATTERN = /^FC2(?:-?PPV)?-?\d+$/iu;

const formatReleaseDateByRule = (releaseDate: string | undefined, rule: string): string | undefined => {
  const normalized = releaseDate?.trim();
  if (!normalized) {
    return undefined;
  }

  const match = normalized.match(/^(\d{4})[-/.]?(\d{1,2})[-/.]?(\d{1,2})/u);
  if (!match) {
    return normalized;
  }

  const year = match[1];
  const month = match[2].padStart(2, "0");
  const day = match[3].padStart(2, "0");
  const template = rule.trim() || "YYYY-MM-DD";

  return template.replaceAll("YYYY", year).replaceAll("MM", month).replaceAll("DD", day);
};

const formatRuntimeMinutes = (durationSeconds: number | undefined): string | undefined => {
  if (durationSeconds === undefined || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return undefined;
  }

  return String(Math.max(1, Math.round(durationSeconds / 60)));
};

const getNumberLetters = (number: string): string | undefined => {
  const normalized = number.trim();
  if (!normalized) {
    return undefined;
  }

  const upper = normalized.toUpperCase();
  for (const prefix of ["FC2", "MYWIFE", "KIN8", "S2M", "T28", "TH101", "XXX-AV"]) {
    if (upper.startsWith(prefix)) {
      return prefix;
    }
  }

  const match = normalized.match(/(\d*[A-Za-z]+)\d*/u);
  return match?.[1]?.toUpperCase();
};

const getNumberFirstLetter = (number: string): string | undefined => {
  const first = number.trim().charAt(0).toUpperCase();
  if (!first) {
    return undefined;
  }

  return /[0-9A-Z]/u.test(first) ? first : "#";
};

/**
 * Template values that come from the movie's metadata alone, so every NFO writer can render them, including the
 * ones that never see the video file. `missingActor` fills `{actor}` when there are no actors and no studio fallback.
 */
export const buildMetadataTemplateData = (
  data: CrawlerData,
  naming: MetadataNaming,
  { missingActor }: { missingActor?: string } = {},
) => {
  const actors = (data.actors ?? []).map((actor) => actor.trim()).filter((actor) => actor.length > 0);
  const studio = data.studio?.trim();
  const studioFallback = actors.length === 0 && naming.actorFallbackToStudio && studio ? studio : undefined;
  const actorNameMax = Math.max(1, naming.actorNameMax);
  const actor =
    actors.length > 0
      ? [...actors.slice(0, actorNameMax), ...(actors.length > actorNameMax ? [naming.actorNameMore] : [])].join(" ")
      : (studioFallback ?? missingActor);
  const releaseDate = formatReleaseDateByRule(data.release_date, naming.releaseRule);
  const outline = data.plot_zh?.trim() || data.plot?.trim();

  return {
    title: data.title_zh?.trim() || data.title,
    originaltitle: data.original_title?.trim() || data.title.trim(),
    rawNumber: data.number,
    actor,
    actorFallbackPrefix: studioFallback
      ? FC2_NUMBER_PATTERN.test(data.number.trim())
        ? "卖家："
        : "片商："
      : undefined,
    firstActor: actors[0] ?? actor,
    allActors: actors.length > 0 ? actors.join(" ") : actor,
    date: releaseDate,
    release: releaseDate,
    year: data.release_date?.trim().match(/^(\d{4})/u)?.[1],
    runtime: formatRuntimeMinutes(data.durationSeconds),
    director: data.director,
    series: data.series,
    studio: data.studio,
    publisher: data.publisher,
    outline,
    plot: outline,
    letters: getNumberLetters(data.number),
    firstLetter: getNumberFirstLetter(data.number),
    score: data.rating,
    rating: data.rating,
    website: data.website,
  };
};
