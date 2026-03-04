import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, relative } from "node:path";
import { toArray } from "@main/utils/common";
import type { ActorProfile, CrawlerData, DownloadedAssets, VideoMeta } from "@shared/types";
import { XMLBuilder } from "fast-xml-parser";
import type { SourceMap } from "./aggregation/types";

const builder = new XMLBuilder({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  format: true,
  commentPropName: "#comment",
});

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
    .map((name) => {
      const profile = profileByName.get(normalizeActorKey(name));
      const node: Record<string, unknown> = { name };

      if (profile?.aliases && profile.aliases.length > 0) {
        node.altname = profile.aliases[0];
      }

      if (profile?.cover_url) {
        node.thumb = profile.cover_url;
      }

      node.role = "Actress";
      return node;
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

export interface NfoOptions {
  assets?: DownloadedAssets;
  sources?: SourceMap;
  videoMeta?: VideoMeta;
}

export class NfoGenerator {
  buildXml(data: CrawlerData, options?: NfoOptions): string {
    const title = data.title_zh?.trim() || data.title;
    const plot = data.plot_zh?.trim() || data.plot?.trim();
    const assets = options?.assets;
    const sources = options?.sources;
    const runtimeMinutes = options?.videoMeta?.durationSeconds
      ? Math.round(options.videoMeta.durationSeconds / 60)
      : undefined;

    const movie: Record<string, unknown> = {};

    // Source attribution comment
    if (sources && Object.keys(sources).length > 0) {
      movie["#comment"] = buildSourceComment(data, sources);
    }

    movie.title = title;
    movie.originaltitle = data.title;
    movie.plot = plot && plot.length > 0 ? plot : undefined;
    movie.premiered = data.release_date;
    movie.year = data.release_year ?? parseReleaseYear(data.release_date);
    movie.runtime = runtimeMinutes;
    movie.rating = data.rating;
    movie.studio = data.studio;
    movie.director = data.director;
    movie.publisher = data.publisher;
    movie.mpaa = "XXX";
    movie.set = data.series;

    if (assets?.trailer) {
      movie.trailer = basename(assets.trailer);
    } else if (data.trailer_url) {
      movie.trailer = data.trailer_url;
    }

    movie.website = data.website;
    movie.uniqueid = {
      "@_type": data.website,
      "@_default": "true",
      "#text": data.number,
    };
    movie.genre = Array.from(new Set(buildStringNodes(toArray(data.genres))));
    movie.tag = movie.genre;
    movie.actor = buildActorNodes(toArray(data.actors), data.actor_profiles);

    // Image thumbs - prefer local asset paths, fall back to URLs
    const thumbs: Array<Record<string, unknown>> = [];
    if (assets?.poster) {
      thumbs.push({ "@_aspect": "poster", "#text": basename(assets.poster) });
    } else if (data.poster_url) {
      thumbs.push({ "@_aspect": "poster", "#text": data.poster_url });
    }
    if (assets?.cover) {
      thumbs.push({ "@_aspect": "thumb", "#text": basename(assets.cover) });
    } else if (data.cover_url) {
      thumbs.push({ "@_aspect": "thumb", "#text": data.cover_url });
    }

    if (thumbs.length > 0) {
      movie.thumb = thumbs;
    }

    // Fanart section - includes fanart + scene images
    const fanartThumbs: Array<Record<string, unknown>> = [];
    if (assets?.fanart) {
      fanartThumbs.push({ "#text": basename(assets.fanart) });
    } else if (data.fanart_url) {
      fanartThumbs.push({ "#text": data.fanart_url });
    }

    if (assets?.sceneImages && assets.sceneImages.length > 0) {
      // Use relative paths: samples/scene-001.jpg
      for (const imagePath of assets.sceneImages) {
        const relativePath = assets.cover
          ? relative(dirname(assets.cover), imagePath)
          : imagePath.split("/").slice(-2).join("/");
        fanartThumbs.push({ "#text": relativePath });
      }
    }

    if (fanartThumbs.length > 0) {
      movie.fanart = { thumb: fanartThumbs.length === 1 ? fanartThumbs[0] : fanartThumbs };
    }

    const xmlBody = builder.build({ movie });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${xmlBody}`;
  }

  async writeNfo(nfoPath: string, data: CrawlerData, options?: NfoOptions): Promise<string> {
    const xml = this.buildXml(data, options);
    await mkdir(dirname(nfoPath), { recursive: true });
    await writeFile(nfoPath, xml, "utf8");
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
    { key: "cover_url", label: "cover_url" },
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
