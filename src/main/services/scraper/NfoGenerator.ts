import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { toArray } from "@main/utils/common";
import { buildManagedMovieTags } from "@main/utils/movieMetadata";
import type { ActorProfile, CrawlerData, DownloadedAssets, VideoMeta } from "@shared/types";
import { XMLBuilder } from "fast-xml-parser";
import type { SourceMap } from "./aggregation/types";

const builder = new XMLBuilder({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  format: true,
  commentPropName: "#comment",
});

const OUTLINE_MAX_CHARS = 200;
const JELLYFIN_MOVIE_NFO_NAME = "movie.nfo";

const normalizeActorKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();

const profileMap = (profiles: ActorProfile[] | undefined): Map<string, ActorProfile> => {
  const map = new Map<string, ActorProfile>();
  for (const profile of profiles ?? []) {
    const key = normalizeActorKey(profile.name);
    if (!key) {
      continue;
    }
    map.set(key, profile);
  }
  return map;
};

const buildActorNodes = (actors: string[], profiles: ActorProfile[] | undefined) => {
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
  if (!releaseDate) {
    return undefined;
  }

  const matched = releaseDate.match(/^(\d{4})/u);
  if (!matched) {
    return undefined;
  }

  const parsed = Number.parseInt(matched[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const buildStringNodes = (values: string[]) => values.map((value) => value.trim()).filter((value) => value.length > 0);
const toRemoteImageSourceUrl = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized && /^https?:\/\//iu.test(normalized) ? normalized : undefined;
};

const truncateText = (value: string, maxChars: number): string => Array.from(value).slice(0, maxChars).join("");

const buildMovieTags = (data: CrawlerData): string[] => {
  return Array.from(
    new Set([
      ...buildStringNodes(toArray(data.genres)),
      ...buildManagedMovieTags({
        contentType: data.content_type,
      }),
    ]),
  );
};

const buildVideoNode = (videoMeta: VideoMeta | undefined): Record<string, unknown> | undefined => {
  if (!videoMeta) {
    return undefined;
  }

  const video: Record<string, unknown> = {};
  if (videoMeta.codec) {
    video.codec = videoMeta.codec;
  }
  if (Number.isFinite(videoMeta.width)) {
    video.width = videoMeta.width;
  }
  if (Number.isFinite(videoMeta.height)) {
    video.height = videoMeta.height;
  }
  if (Number.isFinite(videoMeta.durationSeconds)) {
    video.durationinseconds = videoMeta.durationSeconds;
  }
  if (videoMeta.bitrate !== undefined && Number.isFinite(videoMeta.bitrate)) {
    video.bitrate = videoMeta.bitrate;
  }

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
  if (!primaryFanartUrl) {
    return undefined;
  }

  return { thumb: { "#text": primaryFanartUrl } };
};

export interface NfoOptions {
  assets?: DownloadedAssets;
  sources?: SourceMap;
  videoMeta?: VideoMeta;
}

export class NfoGenerator {
  buildXml(data: CrawlerData, options?: NfoOptions): string {
    const title = data.title_zh?.trim() || data.title;
    const plot = data.plot_zh?.trim() || data.plot?.trim();
    const outline = plot ? truncateText(plot, OUTLINE_MAX_CHARS) : undefined;
    const assets = options?.assets;
    const sources = options?.sources;
    const videoMeta = options?.videoMeta;
    const durationSeconds = videoMeta?.durationSeconds ?? data.durationSeconds;
    const runtimeMinutes = durationSeconds ? Math.round(durationSeconds / 60) : undefined;
    const tags = buildMovieTags(data);
    const videoNode = buildVideoNode(videoMeta);

    const movie: Record<string, unknown> = {};

    // Source attribution comment
    if (sources && Object.keys(sources).length > 0) {
      movie["#comment"] = buildSourceComment(data, sources);
    }

    movie.title = title;
    movie.originaltitle = data.title;
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

    if (assets?.trailer) {
      movie.trailer = basename(assets.trailer);
    } else if (data.trailer_url) {
      movie.trailer = data.trailer_url;
    }

    movie.uniqueid = {
      "@_type": data.website,
      "@_default": "true",
      "#text": data.number,
    };
    movie.genre = Array.from(new Set(buildStringNodes(toArray(data.genres))));
    movie.tag = tags;
    movie.actor = buildActorNodes(toArray(data.actors), data.actor_profiles);

    // Image thumbs - prefer local asset paths, fall back to URLs
    const thumbs: Array<Record<string, unknown>> = [];
    if (assets?.poster) {
      thumbs.push({ "@_aspect": "poster", "#text": basename(assets.poster) });
    } else if (data.poster_url) {
      thumbs.push({ "@_aspect": "poster", "#text": data.poster_url });
    }
    if (assets?.thumb) {
      thumbs.push({ "@_aspect": "thumb", "#text": basename(assets.thumb) });
    } else if (data.thumb_url) {
      thumbs.push({ "@_aspect": "thumb", "#text": data.thumb_url });
    }

    if (thumbs.length > 0) {
      movie.thumb = thumbs;
    }

    const fanartNode = buildFanartNode(data, assets);
    if (fanartNode) {
      movie.fanart = fanartNode;
    }

    const thumbSourceUrl = data.thumb_source_url ?? toRemoteImageSourceUrl(data.thumb_url);
    const posterSourceUrl = data.poster_source_url ?? toRemoteImageSourceUrl(data.poster_url);
    const fanartSourceUrl =
      data.fanart_source_url ??
      toRemoteImageSourceUrl(data.fanart_url) ??
      thumbSourceUrl ??
      toRemoteImageSourceUrl(data.thumb_url);

    movie.thumb_source_url = thumbSourceUrl;
    movie.poster_source_url = posterSourceUrl;
    movie.fanart_source_url = fanartSourceUrl;

    if (videoNode) {
      movie.fileinfo = {
        streamdetails: {
          video: videoNode,
        },
      };
    }

    const xmlBody = builder.build({ movie });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${xmlBody}`;
  }

  async writeNfo(nfoPath: string, data: CrawlerData, options?: NfoOptions): Promise<string> {
    const xml = this.buildXml(data, options);
    await mkdir(dirname(nfoPath), { recursive: true });
    await writeFile(nfoPath, xml, "utf8");
    await writeFile(join(dirname(nfoPath), JELLYFIN_MOVIE_NFO_NAME), xml, "utf8");
    return nfoPath;
  }
}

export const nfoGenerator = new NfoGenerator();

function buildSourceComment(data: CrawlerData, sources: SourceMap): string {
  const lines: string[] = ["\n  Aggregation Sources:"];

  const fields: Array<{ key: keyof CrawlerData; label: string; detail?: () => string }> = [
    { key: "title", label: "title" },
    { key: "plot", label: "plot", detail: () => `${data.plot?.length ?? 0} chars` },
    { key: "actors", label: "actors", detail: () => `${data.actors.length} actors` },
    { key: "thumb_url", label: "thumb_url" },
    { key: "sample_images", label: "sample_images", detail: () => `${data.sample_images.length} images` },
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
