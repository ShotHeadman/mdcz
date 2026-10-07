import { mkdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { atomicWriteFile } from "@mdcz/media-store";
import { NFO_FIELD_OPTIONS, type NfoField } from "@mdcz/shared/config";
import type { CrawlerData, DownloadedAssets, FileInfo, NfoLocalState, VideoMeta } from "@mdcz/shared/types";
import { XMLBuilder, XMLParser } from "fast-xml-parser";
import type { SourceMap } from "./aggregation";
import {
  fingerprintNfo,
  fingerprintNfoField,
  formatFingerprints,
  parseFingerprints,
  publishedFingerprints,
} from "./nfoEdits";

const builder = new XMLBuilder({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  format: true,
  commentPropName: "#comment",
  suppressBooleanAttributes: false,
});
const parser = new XMLParser({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  commentPropName: "#comment",
});

const OUTLINE_MAX_CHARS = 200;
const JELLYFIN_MOVIE_NFO_NAME = "movie.nfo";
export type NfoNamingMode = "both" | "movie" | "filename";

type NfoFileWriter = (path: string, content: string) => Promise<void>;
type PathExists = (path: string) => Promise<boolean>;

export interface NfoOptions {
  assets?: DownloadedAssets;
  sources?: SourceMap;
  videoMeta?: VideoMeta;
  fileInfo?: FileInfo;
  localState?: NfoLocalState;
  nfoNaming?: NfoNamingMode;
  nfoTitleTemplate?: string;
  enabledFields?: readonly NfoField[];
  includeRemoteSceneImageUrls?: boolean;
  allowRemoteTrailerFallback?: boolean;
  buildTags?: (data: CrawlerData, fileInfo: FileInfo | undefined, localState: NfoLocalState | undefined) => string[];
  pathExists?: PathExists;
  writeFile?: NfoFileWriter;
}

const toArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const renderPathTemplate = (template: string, data: Record<string, string | number | undefined>): string =>
  template.replace(/\{([^{}]+)\}/gu, (_match, key: string) => {
    const value = data[key];
    return value === undefined || value === null ? "" : String(value);
  });

const normalizeActorKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();

const profileMap = (
  profiles: CrawlerData["actor_profiles"] | undefined,
): Map<string, NonNullable<CrawlerData["actor_profiles"]>[number]> => {
  const map = new Map<string, NonNullable<CrawlerData["actor_profiles"]>[number]>();
  for (const profile of profiles ?? []) {
    const key = normalizeActorKey(profile.name);
    if (key) {
      map.set(key, profile);
    }
  }
  return map;
};

const buildActorNodes = (actors: string[], profiles: CrawlerData["actor_profiles"] | undefined) => {
  const profileByName = profileMap(profiles);
  return actors
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .map((name, index) => {
      const profile = profileByName.get(normalizeActorKey(name));
      return {
        name,
        type: "Actor",
        thumb: profile?.photo_url,
        order: index,
        sortorder: index,
      };
    });
};

const parseReleaseYear = (releaseDate: string | undefined): number | undefined => {
  if (!releaseDate) return undefined;
  const matched = releaseDate.match(/^(\d{4})/u);
  if (!matched) return undefined;
  const parsed = Number.parseInt(matched[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const buildStringNodes = (values: string[]) => values.map((value) => value.trim()).filter((value) => value.length > 0);
const toRemoteImageSourceUrl = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized && /^https?:\/\//iu.test(normalized) ? normalized : undefined;
};
const truncateText = (value: string, maxChars: number): string => Array.from(value).slice(0, maxChars).join("");

const buildVideoNode = (videoMeta: VideoMeta | undefined): Record<string, unknown> | undefined => {
  if (!videoMeta) return undefined;
  const video: Record<string, unknown> = {};
  if (videoMeta.width !== undefined) video.width = videoMeta.width;
  if (videoMeta.height !== undefined) video.height = videoMeta.height;
  if (videoMeta.durationSeconds !== undefined) video.durationinseconds = Math.floor(videoMeta.durationSeconds);
  if (videoMeta.bitrate !== undefined) video.bitrate = videoMeta.bitrate;
  return Object.keys(video).length > 0 ? video : undefined;
};

const buildFanartNode = (
  data: CrawlerData,
  assets: DownloadedAssets | undefined,
): Record<string, unknown> | undefined => {
  if (assets?.fanart) {
    return { thumb: { "#text": basename(assets.fanart) } };
  }
  const primaryFanartUrl = data.fanart_url || data.thumb_url;
  return primaryFanartUrl ? { thumb: { "#text": primaryFanartUrl } } : undefined;
};

const isNfoFieldEnabled = (enabledFields: readonly NfoField[] | undefined, field: NfoField): boolean =>
  enabledFields === undefined || enabledFields.includes(field);

/** Converts the settings-layer ignore list into the generator's allow list. */
export const nfoIgnoreFieldsToEnabledFields = (
  ignoredFields: readonly NfoField[] | undefined,
): readonly NfoField[] | undefined =>
  ignoredFields === undefined ? undefined : NFO_FIELD_OPTIONS.filter((field) => !ignoredFields.includes(field));

const buildMdczNode = (
  data: CrawlerData,
  rawTitle: string | undefined,
  originalPlot: string | undefined,
  published: string,
  options: NfoOptions | undefined,
): Record<string, unknown> => {
  const enabledFields = options?.enabledFields;
  const includeRemoteSceneImageUrls = options?.includeRemoteSceneImageUrls ?? true;
  const allowRemoteTrailerFallback = options?.allowRemoteTrailerFallback ?? true;
  const remoteThumbSourceUrl = data.thumb_source_url ?? toRemoteImageSourceUrl(data.thumb_url);
  const thumbSourceUrl = isNfoFieldEnabled(enabledFields, "thumb") ? remoteThumbSourceUrl : undefined;
  const posterSourceUrl = isNfoFieldEnabled(enabledFields, "poster")
    ? (data.poster_source_url ?? toRemoteImageSourceUrl(data.poster_url))
    : undefined;
  const fanartSourceUrl = isNfoFieldEnabled(enabledFields, "fanart")
    ? (data.fanart_source_url ?? toRemoteImageSourceUrl(data.fanart_url) ?? remoteThumbSourceUrl)
    : undefined;
  const trailerSourceUrl =
    allowRemoteTrailerFallback && isNfoFieldEnabled(enabledFields, "trailer")
      ? (data.trailer_source_url ?? toRemoteImageSourceUrl(data.trailer_url))
      : undefined;
  const sceneImageUrls =
    includeRemoteSceneImageUrls && isNfoFieldEnabled(enabledFields, "sceneImages")
      ? data.scene_images
          .map((value) => toRemoteImageSourceUrl(value))
          .filter((value): value is string => Boolean(value))
      : [];

  const sourcePin = options?.localState?.sourcePin;
  return {
    raw_title: rawTitle,
    original_plot: originalPlot,
    source_url: sourcePin ? { "@_site": sourcePin.site, "#text": sourcePin.url } : undefined,
    thumb_source_url: thumbSourceUrl,
    poster_source_url: posterSourceUrl,
    fanart_source_url: fanartSourceUrl,
    trailer_source_url: trailerSourceUrl,
    scene_images: sceneImageUrls.length > 0 ? { image: sceneImageUrls } : undefined,
    published,
  };
};

export class NfoGenerator {
  buildXml(data: CrawlerData, options?: NfoOptions): string {
    if (!data.website) {
      throw new Error("NFO missing website");
    }

    const localState = options?.localState;
    const rawTitle = data.title_zh?.trim() || data.title;
    const originaltitle = data.original_title?.trim() || data.title.trim();
    const titleTemplate = options?.nfoTitleTemplate?.trim() || "{title}";
    // A title the user edited is final as written; wrapping it in the template again would repeat the template.
    const title =
      localState?.edits?.title === fingerprintNfoField({ title: rawTitle }, "title")
        ? rawTitle
        : renderPathTemplate(titleTemplate, { title: rawTitle, originaltitle, number: data.number });
    const sourcePlot = data.plot?.trim();
    const plot = data.plot_zh?.trim() || sourcePlot;
    const outline = plot ? truncateText(plot, OUTLINE_MAX_CHARS) : undefined;
    const assets = options?.assets;
    const sources = options?.sources;
    const videoMeta = options?.videoMeta;
    const fileInfo = options?.fileInfo;
    const durationSeconds = videoMeta?.durationSeconds ?? data.durationSeconds;
    const runtimeMinutes = durationSeconds ? Math.round(durationSeconds / 60) : undefined;
    const genres = Array.from(new Set(buildStringNodes(toArray(data.genres))));
    const tags = Array.from(new Set(options?.buildTags?.(data, fileInfo, localState) ?? []));
    const videoNode = buildVideoNode(videoMeta);
    const movie: Record<string, unknown> = {};
    const enabledFields = options?.enabledFields;
    const allowRemoteTrailerFallback = options?.allowRemoteTrailerFallback ?? true;

    if (isNfoFieldEnabled(enabledFields, "sourceComment") && sources && Object.keys(sources).length > 0) {
      movie["#comment"] = buildSourceComment(data, sources);
    }

    movie.title = title;
    // Original-language tags are only written when they differ, so untranslated NFOs carry no duplicate text.
    movie.originaltitle = originaltitle !== title ? originaltitle : undefined;
    movie.plot = isNfoFieldEnabled(enabledFields, "plot") && plot && plot.length > 0 ? plot : undefined;
    movie.outline =
      isNfoFieldEnabled(enabledFields, "plot") && isNfoFieldEnabled(enabledFields, "outline") ? outline : undefined;
    movie.premiered = isNfoFieldEnabled(enabledFields, "release") ? data.release_date : undefined;
    movie.releasedate = isNfoFieldEnabled(enabledFields, "release") ? data.release_date : undefined;
    movie.dateadded = new Date().toISOString();
    movie.lockedfields = localState?.lockedFields?.length ? localState.lockedFields.join("|") : undefined;
    movie.year = isNfoFieldEnabled(enabledFields, "release") ? parseReleaseYear(data.release_date) : undefined;
    movie.runtime = isNfoFieldEnabled(enabledFields, "runtime") ? runtimeMinutes : undefined;
    movie.rating = isNfoFieldEnabled(enabledFields, "rating") ? data.rating : undefined;
    movie.studio = isNfoFieldEnabled(enabledFields, "studio") ? data.studio : undefined;
    movie.director = isNfoFieldEnabled(enabledFields, "director") ? data.director : undefined;
    movie.publisher = isNfoFieldEnabled(enabledFields, "publisher") ? data.publisher : undefined;
    movie.mpaa = "JP-18+";
    movie.set = isNfoFieldEnabled(enabledFields, "series") ? data.series : undefined;
    movie.trailer = isNfoFieldEnabled(enabledFields, "trailer")
      ? assets?.trailer
        ? basename(assets.trailer)
        : allowRemoteTrailerFallback
          ? data.trailer_url
          : undefined
      : undefined;
    movie.num = isNfoFieldEnabled(enabledFields, "num") ? data.number : undefined;
    movie.uniqueid = { "@_type": data.website, "@_default": "true", "#text": data.number };
    movie.genre = isNfoFieldEnabled(enabledFields, "genres") ? genres : undefined;
    movie.tag = isNfoFieldEnabled(enabledFields, "tags") && tags.length > 0 ? tags : undefined;
    movie.actor = buildActorNodes(toArray(data.actors), data.actor_profiles);

    const thumbs: Array<Record<string, unknown>> = [];
    if (isNfoFieldEnabled(enabledFields, "poster")) {
      if (assets?.poster) thumbs.push({ "@_aspect": "poster", "#text": basename(assets.poster) });
      else if (data.poster_url) thumbs.push({ "@_aspect": "poster", "#text": data.poster_url });
    }
    if (isNfoFieldEnabled(enabledFields, "thumb")) {
      if (assets?.thumb) thumbs.push({ "@_aspect": "thumb", "#text": basename(assets.thumb) });
      else if (data.thumb_url) thumbs.push({ "@_aspect": "thumb", "#text": data.thumb_url });
    }
    if (thumbs.length > 0) movie.thumb = thumbs;

    if (isNfoFieldEnabled(enabledFields, "fanart")) {
      const fanartNode = buildFanartNode(data, assets);
      if (fanartNode) movie.fanart = fanartNode;
    }
    movie.mdcz = buildMdczNode(
      data,
      rawTitle !== title ? rawTitle : undefined,
      isNfoFieldEnabled(enabledFields, "plot") && sourcePlot !== plot ? sourcePlot : undefined,
      formatFingerprints(publishedFingerprints(movie, localState)),
      options,
    );
    const fileinfo = videoNode ? { streamdetails: { video: videoNode } } : localState?.fileinfo;
    if (isNfoFieldEnabled(enabledFields, "fileinfo") && fileinfo) movie.fileinfo = fileinfo;

    const xmlBody = builder.build({ movie });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${xmlBody}`;
  }

  mergeEditableXml(existingXml: string, data: CrawlerData, options?: NfoOptions): string {
    return mergeEditableNfoDocuments(existingXml, this.buildXml(data, options));
  }

  async writeNfo(nfoPath: string, data: CrawlerData, options?: NfoOptions): Promise<string> {
    const write = options?.writeFile ?? atomicWriteFile;
    const xml = this.buildXml(data, options);
    const nfoNaming = options?.nfoNaming ?? "both";
    const { primaryPath, canonicalPath, requiredPaths } = getNfoWritePaths(nfoPath, nfoNaming);
    if (!options?.writeFile) await mkdir(dirname(primaryPath), { recursive: true });

    for (const requiredPath of requiredPaths) await write(requiredPath, xml);
    return canonicalPath;
  }
}

export const nfoGenerator = new NfoGenerator();

export const resolveCanonicalNfoPath = (nfoPath: string, nfoNaming: NfoNamingMode = "both"): string =>
  getNfoWritePaths(nfoPath, nfoNaming).canonicalPath;

export const resolveFilenameNfoPath = (nfoPath: string, videoPath?: string): string =>
  videoPath && dirname(resolve(nfoPath)) !== dirname(resolve(videoPath))
    ? replaceExtension(nfoPath, ".nfo")
    : replaceExtension(videoPath ?? nfoPath, ".nfo");

export const getNfoReadCandidates = (
  nfoPath: string,
  nfoNaming: NfoNamingMode = "both",
  videoPath?: string,
): string[] => {
  const plannedPath = resolveFilenameNfoPath(nfoPath, videoPath);
  const { primaryPath, moviePath, canonicalPath } = getNfoWritePaths(plannedPath, nfoNaming);
  return Array.from(new Set([canonicalPath, primaryPath, moviePath, nfoPath]));
};

export const findExistingNfoPath = async (
  nfoPath: string,
  nfoNaming: NfoNamingMode = "both",
  pathExists: PathExists,
  videoPath?: string,
): Promise<string | undefined> => {
  const candidates = getNfoReadCandidates(nfoPath, nfoNaming, videoPath);
  for (const candidatePath of candidates) {
    if (await pathExists(candidatePath)) return candidatePath;
  }
  return undefined;
};

const EDITABLE_MOVIE_FIELDS = [
  "title",
  "originaltitle",
  "num",
  "plot",
  "outline",
  "premiered",
  "releasedate",
  "year",
  "runtime",
  "rating",
  "studio",
  "director",
  "publisher",
  "set",
  "trailer",
  "uniqueid",
  "genre",
  "thumb",
  "fanart",
  "tag",
  "lockedfields",
] as const;
const EDITABLE_MDCZ_FIELDS = [
  "raw_title",
  "original_plot",
  "source_url",
  "thumb_source_url",
  "poster_source_url",
  "fanart_source_url",
  "trailer_source_url",
  "scene_images",
  "published",
] as const;

const requireXmlRecord = (value: unknown, message: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
};

const toRecordOrEmpty = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const mergeEditableNfoDocuments = (existingXml: string, generatedXml: string): string => {
  const existingRoot = requireXmlRecord(parser.parse(existingXml), "Invalid NFO root");
  const existingMovie = requireXmlRecord(existingRoot.movie, "Invalid NFO movie node");
  const generatedRoot = requireXmlRecord(parser.parse(generatedXml), "Invalid generated NFO root");
  const generatedMovie = requireXmlRecord(generatedRoot.movie, "Invalid generated NFO movie node");
  const existingMdcz = toRecordOrEmpty(existingMovie.mdcz);
  // Editing is not publishing: keeping the fingerprints of what MDCz published makes the changed values read as edits.
  const published = formatFingerprints({
    ...fingerprintNfo(existingMovie),
    ...parseFingerprints(existingMdcz.published),
  });

  for (const field of EDITABLE_MOVIE_FIELDS) {
    if (field in generatedMovie) existingMovie[field] = generatedMovie[field];
    else delete existingMovie[field];
  }
  existingMovie.actor = mergeActorNodes(existingMovie.actor, generatedMovie.actor);

  const generatedMdcz: Record<string, unknown> = {
    ...requireXmlRecord(generatedMovie.mdcz, "Invalid generated NFO mdcz node"),
    published,
  };
  for (const field of EDITABLE_MDCZ_FIELDS) {
    if (field in generatedMdcz) existingMdcz[field] = generatedMdcz[field];
    else delete existingMdcz[field];
  }
  existingMovie.mdcz = existingMdcz;

  existingRoot.movie = existingMovie;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${builder.build(existingRoot)}`;
};

const actorNodeName = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const name = (value as Record<string, unknown>).name;
  return typeof name === "string" ? name.trim() : "";
};

const mergeActorNodes = (existing: unknown, generated: unknown): unknown => {
  const existingActors = toArray(existing);
  const generatedActors = toArray(generated);
  const existingByName = new Map(existingActors.map((actor) => [normalizeActorKey(actorNodeName(actor)), actor]));
  return generatedActors.map((actor) => {
    const previous = existingByName.get(normalizeActorKey(actorNodeName(actor)));
    if (!(previous && typeof previous === "object" && actor && typeof actor === "object")) return actor;
    const merged = { ...(previous as Record<string, unknown>), ...(actor as Record<string, unknown>) };
    if (!("thumb" in (actor as Record<string, unknown>))) delete merged.thumb;
    return merged;
  });
};

export interface NfoNamingPaths {
  primaryPath: string;
  moviePath: string;
  canonicalPath: string;
  requiredPaths: string[];
}

const siblingPath = (filePath: string, fileName: string): string => {
  const separatorIndex = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return `${filePath.slice(0, separatorIndex + 1)}${fileName}`;
};

export const getNfoWritePaths = (nfoPath: string, nfoNaming: NfoNamingMode = "both"): NfoNamingPaths => {
  const primaryPath = nfoPath;
  const moviePath = siblingPath(nfoPath, JELLYFIN_MOVIE_NFO_NAME);
  if (nfoNaming === "movie") {
    return {
      primaryPath,
      moviePath,
      canonicalPath: moviePath,
      requiredPaths: [moviePath],
    };
  }
  if (nfoNaming === "filename") {
    return {
      primaryPath,
      moviePath,
      canonicalPath: primaryPath,
      requiredPaths: [primaryPath],
    };
  }
  return {
    primaryPath,
    moviePath,
    canonicalPath: primaryPath,
    requiredPaths: primaryPath === moviePath ? [primaryPath] : [primaryPath, moviePath],
  };
};

const replaceExtension = (filePath: string, extension: string): string => {
  const separatorIndex = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const extensionIndex = filePath.lastIndexOf(".");
  return extensionIndex > separatorIndex
    ? `${filePath.slice(0, extensionIndex)}${extension}`
    : `${filePath}${extension}`;
};

function buildSourceComment(data: CrawlerData, sources: SourceMap): string {
  const lines: string[] = ["\n  Aggregation Sources:"];
  const fields: Array<{ key: keyof CrawlerData; label: string; detail?: () => string }> = [
    { key: "title", label: "title" },
    { key: "plot", label: "plot", detail: () => `${data.plot?.length ?? 0} chars` },
    { key: "actors", label: "actors", detail: () => `${data.actors.length} actors` },
    { key: "poster_url", label: "poster_url" },
    { key: "thumb_url", label: "thumb_url" },
    { key: "fanart_url", label: "fanart_url" },
    { key: "scene_images", label: "scene_images", detail: () => `${data.scene_images.length} images` },
    { key: "trailer_url", label: "trailer_url" },
    { key: "studio", label: "studio" },
    { key: "genres", label: "genres", detail: () => `${data.genres.length} genres` },
  ];
  for (const field of fields) {
    const source = sources[field.key];
    if (source) {
      const extra = field.detail ? ` (${field.detail()})` : "";
      lines.push(`    ${field.label}: ${source}${extra}`);
    }
  }
  lines.push(`    Crawled: ${new Date().toISOString()}`);
  lines.push("  ");
  return lines.join("\n");
}
