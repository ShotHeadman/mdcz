import { copyFile, mkdir, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData, DownloadedAssets, FileInfo, NfoLocalState, VideoMeta } from "@mdcz/shared/types";
import { XMLBuilder } from "fast-xml-parser";
import type { SourceMap } from "./aggregation";

const builder = new XMLBuilder({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  format: true,
  commentPropName: "#comment",
  suppressBooleanAttributes: false,
});

const OUTLINE_MAX_CHARS = 200;
const JELLYFIN_MOVIE_NFO_NAME = "movie.nfo";
type NfoNamingMode = "both" | "movie" | "filename";

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
  if (Number.isFinite(videoMeta.width)) video.width = videoMeta.width;
  if (Number.isFinite(videoMeta.height)) video.height = videoMeta.height;
  if (Number.isFinite(videoMeta.durationSeconds)) video.durationinseconds = Math.floor(videoMeta.durationSeconds);
  if (videoMeta.bitrate !== undefined && Number.isFinite(videoMeta.bitrate)) video.bitrate = videoMeta.bitrate;
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

const buildMdczNode = (data: CrawlerData, rawTitle?: string): Record<string, unknown> | undefined => {
  const thumbSourceUrl = data.thumb_source_url ?? toRemoteImageSourceUrl(data.thumb_url);
  const posterSourceUrl = data.poster_source_url ?? toRemoteImageSourceUrl(data.poster_url);
  const fanartSourceUrl =
    data.fanart_source_url ??
    toRemoteImageSourceUrl(data.fanart_url) ??
    thumbSourceUrl ??
    toRemoteImageSourceUrl(data.thumb_url);
  const trailerSourceUrl = data.trailer_source_url ?? toRemoteImageSourceUrl(data.trailer_url);
  const sceneImageUrls = data.scene_images
    .map((value) => toRemoteImageSourceUrl(value))
    .filter((value): value is string => Boolean(value));

  if (
    !rawTitle &&
    !thumbSourceUrl &&
    !posterSourceUrl &&
    !fanartSourceUrl &&
    !trailerSourceUrl &&
    sceneImageUrls.length === 0
  ) {
    return undefined;
  }

  return {
    raw_title: rawTitle,
    thumb_source_url: thumbSourceUrl,
    poster_source_url: posterSourceUrl,
    fanart_source_url: fanartSourceUrl,
    trailer_source_url: trailerSourceUrl,
    scene_images: sceneImageUrls.length > 0 ? { image: sceneImageUrls } : undefined,
  };
};

export class NfoGenerator {
  buildXml(data: CrawlerData, options?: NfoOptions): string {
    const rawTitle = data.title_zh?.trim() || data.title;
    const originaltitle = data.title.trim();
    const titleTemplate = options?.nfoTitleTemplate?.trim() || "{title}";
    const title = renderPathTemplate(titleTemplate, { title: rawTitle, originaltitle, number: data.number });
    const plot = data.plot_zh?.trim() || data.plot?.trim();
    const outline = plot ? truncateText(plot, OUTLINE_MAX_CHARS) : undefined;
    const assets = options?.assets;
    const sources = options?.sources;
    const videoMeta = options?.videoMeta;
    const fileInfo = options?.fileInfo;
    const localState = options?.localState;
    const durationSeconds = videoMeta?.durationSeconds ?? data.durationSeconds;
    const runtimeMinutes = durationSeconds ? Math.round(durationSeconds / 60) : undefined;
    const genres = Array.from(new Set(buildStringNodes(toArray(data.genres))));
    const tags = Array.from(new Set(options?.buildTags?.(data, fileInfo, localState) ?? []));
    const videoNode = buildVideoNode(videoMeta);
    const movie: Record<string, unknown> = {};

    if (sources && Object.keys(sources).length > 0) {
      movie["#comment"] = buildSourceComment(data, sources);
    }

    movie.title = title;
    movie.originaltitle = originaltitle;
    movie.plot = plot && plot.length > 0 ? plot : undefined;
    movie.outline = outline;
    movie.premiered = data.release_date;
    movie.releasedate = data.release_date;
    movie.dateadded = new Date().toISOString();
    movie.year = parseReleaseYear(data.release_date);
    movie.runtime = runtimeMinutes;
    movie.rating = data.rating;
    movie.studio = data.studio;
    movie.director = data.director;
    movie.publisher = data.publisher;
    movie.mpaa = "JP-18+";
    movie.set = data.series;
    movie.trailer = assets?.trailer ? basename(assets.trailer) : data.trailer_url;
    movie.uniqueid = { "@_type": data.website, "@_default": "true", "#text": data.number };
    movie.genre = genres;
    movie.tag = tags.length > 0 ? tags : undefined;
    movie.actor = buildActorNodes(toArray(data.actors), data.actor_profiles);

    const thumbs: Array<Record<string, unknown>> = [];
    if (assets?.poster) thumbs.push({ "@_aspect": "poster", "#text": basename(assets.poster) });
    else if (data.poster_url) thumbs.push({ "@_aspect": "poster", "#text": data.poster_url });
    if (assets?.thumb) thumbs.push({ "@_aspect": "thumb", "#text": basename(assets.thumb) });
    else if (data.thumb_url) thumbs.push({ "@_aspect": "thumb", "#text": data.thumb_url });
    if (thumbs.length > 0) movie.thumb = thumbs;

    const fanartNode = buildFanartNode(data, assets);
    if (fanartNode) movie.fanart = fanartNode;
    const hasCustomTitleTemplate = titleTemplate !== "{title}";
    const mdczNode = buildMdczNode(data, hasCustomTitleTemplate ? rawTitle : undefined);
    if (mdczNode) movie.mdcz = mdczNode;
    if (videoNode) movie.fileinfo = { streamdetails: { video: videoNode } };

    const xmlBody = builder.build({ movie });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${xmlBody}`;
  }

  async writeNfo(nfoPath: string, data: CrawlerData, options?: NfoOptions): Promise<string> {
    const write =
      options?.writeFile ??
      ((filePath, content) => import("node:fs/promises").then((fs) => fs.writeFile(filePath, content, "utf8")));
    const xml = this.buildXml(data, options);
    const nfoNaming = options?.nfoNaming ?? "both";
    const { primaryPath, moviePath, canonicalPath, stalePaths } = getNfoNamingPaths(nfoPath, nfoNaming);
    await mkdir(dirname(primaryPath), { recursive: true });

    if (nfoNaming === "both") {
      await write(primaryPath, xml);
      await write(moviePath, xml);
      return canonicalPath;
    }

    if (nfoNaming === "movie") {
      await write(moviePath, xml);
      for (const stalePath of stalePaths) await tryRemoveStaleNfo(stalePath, options?.pathExists);
      return canonicalPath;
    }

    await write(primaryPath, xml);
    for (const stalePath of stalePaths) await tryRemoveStaleNfo(stalePath, options?.pathExists);
    return canonicalPath;
  }
}

export const nfoGenerator = new NfoGenerator();

export const resolveCanonicalNfoPath = (nfoPath: string, nfoNaming: NfoNamingMode = "both"): string =>
  getNfoNamingPaths(nfoPath, nfoNaming).canonicalPath;

export const findExistingNfoPath = async (
  nfoPath: string,
  nfoNaming: NfoNamingMode = "both",
  pathExists: PathExists,
): Promise<string | undefined> => {
  const { primaryPath, moviePath, canonicalPath } = getNfoNamingPaths(nfoPath, nfoNaming);
  const candidates = Array.from(new Set([canonicalPath, primaryPath, moviePath]));
  for (const candidatePath of candidates) {
    if (await pathExists(candidatePath)) return candidatePath;
  }
  return undefined;
};

export const reconcileExistingNfoFiles = async (
  nfoPath: string,
  nfoNaming: NfoNamingMode = "both",
  pathExists: PathExists,
): Promise<string | undefined> => {
  const { primaryPath, canonicalPath, requiredPaths, stalePaths } = getNfoNamingPaths(nfoPath, nfoNaming);
  const sourcePath = await findExistingNfoPath(nfoPath, nfoNaming, pathExists);
  if (!sourcePath) return undefined;
  await mkdir(dirname(primaryPath), { recursive: true });
  for (const requiredPath of requiredPaths) {
    if (requiredPath === sourcePath || (await pathExists(requiredPath))) continue;
    await copyFile(sourcePath, requiredPath);
  }
  for (const stalePath of stalePaths) await tryRemoveStaleNfo(stalePath, pathExists);
  return canonicalPath;
};

interface NfoNamingPaths {
  primaryPath: string;
  moviePath: string;
  canonicalPath: string;
  requiredPaths: string[];
  stalePaths: string[];
}

const getNfoNamingPaths = (nfoPath: string, nfoNaming: NfoNamingMode): NfoNamingPaths => {
  const primaryPath = nfoPath;
  const moviePath = join(dirname(nfoPath), JELLYFIN_MOVIE_NFO_NAME);
  if (nfoNaming === "movie") {
    return {
      primaryPath,
      moviePath,
      canonicalPath: moviePath,
      requiredPaths: [moviePath],
      stalePaths: primaryPath === moviePath ? [] : [primaryPath],
    };
  }
  if (nfoNaming === "filename") {
    return {
      primaryPath,
      moviePath,
      canonicalPath: primaryPath,
      requiredPaths: [primaryPath],
      stalePaths: primaryPath === moviePath ? [] : [moviePath],
    };
  }
  return {
    primaryPath,
    moviePath,
    canonicalPath: primaryPath,
    requiredPaths: primaryPath === moviePath ? [primaryPath] : [primaryPath, moviePath],
    stalePaths: [],
  };
};

async function tryRemoveStaleNfo(stalePath: string, pathExists?: PathExists): Promise<void> {
  try {
    if (!pathExists || (await pathExists(stalePath))) {
      await rm(stalePath);
    }
  } catch {
    return;
  }
}

function buildSourceComment(data: CrawlerData, sources: SourceMap): string {
  const lines: string[] = ["\n  Aggregation Sources:"];
  const fields: Array<{ key: keyof CrawlerData; label: string; detail?: () => string }> = [
    { key: "title", label: "title" },
    { key: "plot", label: "plot", detail: () => `${data.plot?.length ?? 0} chars` },
    { key: "actors", label: "actors", detail: () => `${data.actors.length} actors` },
    { key: "thumb_url", label: "thumb_url" },
    { key: "scene_images", label: "scene_images", detail: () => `${data.scene_images.length} images` },
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

const readTag = (xml: string, tag: string): string | undefined => {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "u"));
  return match?.[1]
    ?.replace(/&quot;/gu, '"')
    .replace(/&gt;/gu, ">")
    .replace(/&lt;/gu, "<")
    .replace(/&amp;/gu, "&")
    .trim();
};

export const inferNumber = (relativePath: string): string => {
  const base = basename(
    relativePath,
    relativePath.includes(".") ? relativePath.slice(relativePath.lastIndexOf(".")) : undefined,
  );
  const match = base.match(/[A-Za-z]{2,10}[-_ ]?\d{2,6}|FC2[-_ ]?\d{5,8}|\d{6,}/u);
  return (match?.[0] ?? base).replace(/[ _]/gu, "-").toUpperCase();
};

export const parseNfo = (xml: string, fallbackPath: string): CrawlerData => {
  const actors = Array.from(xml.matchAll(/<actor>\s*<name>([\s\S]*?)<\/name>\s*<\/actor>/gu)).map((match) =>
    match[1].trim(),
  );
  const genres = Array.from(xml.matchAll(/<genre>([\s\S]*?)<\/genre>/gu)).map((match) => match[1].trim());
  return {
    title:
      readTag(xml, "title") ??
      basename(
        fallbackPath,
        fallbackPath.includes(".") ? fallbackPath.slice(fallbackPath.lastIndexOf(".")) : undefined,
      ),
    title_zh: readTag(xml, "originaltitle"),
    number: readTag(xml, "id") ?? inferNumber(fallbackPath),
    actors,
    genres,
    studio: readTag(xml, "studio"),
    director: readTag(xml, "director"),
    publisher: readTag(xml, "publisher"),
    series: readTag(xml, "set"),
    plot: readTag(xml, "plot"),
    plot_zh: readTag(xml, "outline"),
    release_date: readTag(xml, "premiered"),
    thumb_url: readTag(xml, "thumb"),
    poster_url: readTag(xml, "poster"),
    scene_images: [],
    website: Website.JAVDB,
  };
};
