import { Website } from "@mdcz/shared/enums";
import type { ActorProfile, CrawlerData, NfoLocalState } from "@mdcz/shared/types";
import { XMLParser } from "fast-xml-parser";
import { detectNfoEdits, parseFingerprints } from "../scrape/nfoEdits";
import { isManagedMovieTag, normalizeNfoLocalState, parseManagedMovieTags, tagToUncensoredChoice } from "./movieTags";

const WEBSITE_VALUES: Readonly<Record<Website, true>> = Object.fromEntries(
  Object.values(Website).map((website) => [website, true]),
) as Record<Website, true>;
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

// MDCx writes external IDs as <{site}id>. Keep only sites present in both projects.
const MDCX_PROVIDER_TAGS: Readonly<Record<string, Website>> = {
  dahliaid: Website.DAHLIA,
  dmmid: Website.DMM,
  falenoid: Website.FALENO,
  fc2hubid: Website.FC2HUB,
  fc2id: Website.FC2,
  jav321id: Website.JAV321,
  javbusid: Website.JAVBUS,
  javdbid: Website.JAVDB,
  javdbsearchid: Website.JAVDB,
  mgstageid: Website.MGSTAGE,
  prestigeid: Website.PRESTIGE,
};

const toArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const parseWebsite = (value: unknown): Website | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return WEBSITE_VALUES[normalized as Website] ? (normalized as Website) : null;
};

const toStringValue = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number") return String(value);
  return undefined;
};

const toRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;

const toStringArray = (value: unknown): string[] =>
  toArray(value)
    .map((item) => toStringValue(item) ?? "")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const getNodeText = (value: unknown): string | undefined => toStringValue(toRecord(value)?.["#text"] ?? value);

interface NfoIdentifier {
  number?: string;
  website?: Website;
}

const resolveNfoIdentifier = (movieNode: Record<string, unknown>): NfoIdentifier => {
  const uniqueIds = toArray(movieNode.uniqueid);
  const standardUniqueId = uniqueIds.find((item) => parseWebsite(toRecord(item)?.["@_type"]));
  if (standardUniqueId !== undefined) {
    return {
      number: getNodeText(standardUniqueId),
      website: parseWebsite(toRecord(standardUniqueId)?.["@_type"]) ?? undefined,
    };
  }

  const number =
    getNodeText(movieNode.num) ??
    uniqueIds.map((item) => toRecord(item)).find((item) => !toStringValue(item?.["@_type"]))?.["#text"] ??
    uniqueIds.find((item) => !toRecord(item));

  const providerWebsite = Object.entries(MDCX_PROVIDER_TAGS).find(([tag]) => getNodeText(movieNode[tag]))?.[1];
  return {
    number: toStringValue(number),
    website: providerWebsite,
  };
};

interface ThumbEntry {
  aspect?: string;
  value: string;
}

const parseThumbEntries = (value: unknown): ThumbEntry[] =>
  toArray(value)
    .map((item): ThumbEntry | null => {
      if (typeof item === "string") {
        const text = toStringValue(item);
        return text ? { value: text } : null;
      }
      const node = toRecord(item);
      const text = toStringValue(node?.["#text"]);
      return text ? { aspect: toStringValue(node?.["@_aspect"])?.toLowerCase(), value: text } : null;
    })
    .filter((item): item is ThumbEntry => item !== null);

const pickThumbByAspect = (thumbs: ThumbEntry[], aspects: string[]): string | undefined => {
  const normalizedAspects = aspects.map((aspect) => aspect.toLowerCase());
  return thumbs.find((entry) => entry.aspect && normalizedAspects.includes(entry.aspect))?.value;
};

// NFOs from other tools may carry only <runtime>, in minutes.
const parseDurationSeconds = (movieNode: Record<string, unknown>): number | undefined => {
  const video = toRecord(toRecord(toRecord(movieNode.fileinfo)?.streamdetails)?.video);
  const seconds = Number.parseInt(toStringValue(video?.durationinseconds) ?? "", 10);
  if (seconds > 0) return seconds;
  const minutes = Number.parseInt(toStringValue(movieNode.runtime) ?? "", 10);
  return minutes > 0 ? minutes * 60 : undefined;
};

export interface ParsedNfoSnapshot {
  crawlerData: CrawlerData;
  localState?: NfoLocalState;
}

export const parseNfoSnapshot = (xml: string): ParsedNfoSnapshot => {
  const root = parser.parse(xml) as unknown;
  const movie = root && typeof root === "object" ? (root as Record<string, unknown>).movie : undefined;
  if (!movie || typeof movie !== "object") throw new Error("Invalid NFO movie node");

  const movieNode = movie as Record<string, unknown>;
  const title =
    toStringValue(movieNode.title) ?? toStringValue(movieNode.originaltitle) ?? toStringValue(movieNode.name) ?? "";
  const originaltitle = toStringValue(movieNode.originaltitle);
  const plot = toStringValue(movieNode.plot);
  const premiered = toStringValue(movieNode.premiered);
  const releasedate = toStringValue(movieNode.releasedate);
  const releaseDate = premiered ?? releasedate;
  const ratingText = toStringValue(movieNode.rating);
  const identifier = resolveNfoIdentifier(movieNode);
  const number = identifier.number ?? "";
  if (!number) throw new Error("NFO missing number");
  if (!title) throw new Error("NFO missing title");

  const actorNodes = toArray(movieNode.actor);
  const actors = actorNodes
    .map((node) => (typeof node === "string" ? node : (toStringValue(toRecord(node)?.name) ?? "")))
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const actorProfiles = actorNodes
    .map((node): ActorProfile | null => {
      const fields = toRecord(node);
      const name = toStringValue(fields?.name);
      return name ? { name, photo_url: toStringValue(fields?.thumb) } : null;
    })
    .filter((item): item is ActorProfile => item !== null);

  const genres = toStringArray(movieNode.genre);
  const tags = toStringArray(movieNode.tag);
  const managedMovieTags = parseManagedMovieTags(tags);
  let uncensoredChoice: NfoLocalState["uncensoredChoice"];
  const localTags: string[] = [];
  for (const tag of tags) {
    if (isManagedMovieTag(tag)) continue;
    const choice = tagToUncensoredChoice(tag);
    if (choice) {
      uncensoredChoice ??= choice;
      continue;
    }
    localTags.push(tag);
  }

  const thumbs = parseThumbEntries(movieNode.thumb);
  const posterUrl = pickThumbByAspect(thumbs, ["poster"]);
  const thumbUrl =
    pickThumbByAspect(thumbs, ["thumb", "landscape"]) ??
    thumbs.find((entry) => !entry.aspect)?.value ??
    thumbs[0]?.value;
  const fanartThumbs =
    movieNode.fanart && typeof movieNode.fanart === "object"
      ? toArray((movieNode.fanart as Record<string, unknown>).thumb)
          .map((item) => (typeof item === "string" ? toStringValue(item) : toStringValue(toRecord(item)?.["#text"])))
          .filter((item): item is string => Boolean(item))
      : [];
  const mdczNode = toRecord(movieNode.mdcz);
  const mdczSceneImagesNode = toRecord(mdczNode?.scene_images);
  const published = parseFingerprints(mdczNode?.published);
  const sourceUrlNode = toRecord(mdczNode?.source_url);
  const pinnedSite = parseWebsite(sourceUrlNode?.["@_site"]);
  const pinnedUrl = toStringValue(sourceUrlNode?.["#text"]);
  const edits = detectNfoEdits(movieNode, published);
  // raw_title is the untemplated title MDCz wrote; once the title was edited, only the edited text counts.
  const shownTitle = (!edits.title && toStringValue(mdczNode?.raw_title)) || title;
  const sourceTitle = originaltitle ?? shownTitle;
  const shownPlot = plot ?? toStringValue(movieNode.outline);
  const sourcePlot = toStringValue(mdczNode?.original_plot) ?? shownPlot;
  const rating = ratingText ? Number.parseFloat(ratingText) : undefined;
  const durationSeconds = parseDurationSeconds(movieNode);

  return {
    crawlerData: {
      title: sourceTitle,
      title_zh: shownTitle !== sourceTitle ? shownTitle : undefined,
      number,
      actors,
      actor_profiles: actorProfiles.length > 0 ? actorProfiles : undefined,
      genres,
      studio: toStringValue(movieNode.studio),
      director: toStringValue(movieNode.director),
      publisher: toStringValue(movieNode.publisher),
      series:
        toStringValue(movieNode.set) ?? toStringValue(toRecord(movieNode.set)?.name) ?? toStringValue(movieNode.series),
      plot: sourcePlot,
      plot_zh: shownPlot !== sourcePlot ? shownPlot : undefined,
      release_date: releaseDate,
      durationSeconds,
      rating: Number.isFinite(rating) ? rating : undefined,
      content_type: managedMovieTags.content_type,
      thumb_url: thumbUrl,
      poster_url: posterUrl,
      fanart_url: fanartThumbs[0],
      thumb_source_url: toStringValue(mdczNode?.thumb_source_url),
      poster_source_url: toStringValue(mdczNode?.poster_source_url),
      fanart_source_url: toStringValue(mdczNode?.fanart_source_url),
      trailer_source_url: toStringValue(mdczNode?.trailer_source_url) ?? toStringValue(movieNode.trailer_source_url),
      scene_images: toStringArray(mdczSceneImagesNode?.image),
      trailer_url: toStringValue(movieNode.trailer),
      website: identifier.website,
    },
    localState: normalizeNfoLocalState({
      uncensoredChoice,
      tags: localTags,
      lockedFields: toStringValue(movieNode.lockedfields)?.split("|"),
      published,
      edits,
      fileinfo: toRecord(movieNode.fileinfo),
      sourcePin: pinnedSite && pinnedUrl ? { site: pinnedSite, url: pinnedUrl } : undefined,
    }),
  };
};
