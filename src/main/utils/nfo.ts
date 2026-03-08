import { toArray } from "@main/utils/common";
import { Website } from "@shared/enums";
import type { ActorProfile, CrawlerData } from "@shared/types";
import { XMLParser } from "fast-xml-parser";

const WEBSITE_VALUES = new Set(Object.values(Website));

const parseWebsite = (value: unknown): Website | null => {
  if (typeof value !== "string") {
    return null;
  }
  return WEBSITE_VALUES.has(value as Website) ? (value as Website) : null;
};

const toStringValue = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
};

interface ThumbEntry {
  aspect?: string;
  value: string;
}

const parseThumbEntries = (value: unknown): ThumbEntry[] => {
  return toArray(value)
    .map((item): ThumbEntry | null => {
      if (typeof item === "string") {
        const text = toStringValue(item);
        return text ? { value: text } : null;
      }

      if (!item || typeof item !== "object") {
        return null;
      }

      const node = item as Record<string, unknown>;
      const text = toStringValue(node["#text"]);
      if (!text) {
        return null;
      }

      return {
        aspect: toStringValue(node["@_aspect"])?.toLowerCase(),
        value: text,
      };
    })
    .filter((item): item is ThumbEntry => item !== null);
};

const pickThumbByAspect = (thumbs: ThumbEntry[], aspects: string[]): string | undefined => {
  const normalizedAspects = aspects.map((aspect) => aspect.toLowerCase());
  return thumbs.find((entry) => entry.aspect && normalizedAspects.includes(entry.aspect))?.value;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

export const parseNfo = (xml: string): CrawlerData => {
  const root = parser.parse(xml) as unknown;
  if (!root || typeof root !== "object" || !("movie" in root)) {
    throw new Error("Invalid NFO root");
  }

  const movie = (root as Record<string, unknown>).movie;
  if (!movie || typeof movie !== "object") {
    throw new Error("Invalid NFO movie node");
  }

  const movieNode = movie as Record<string, unknown>;
  const title = toStringValue(movieNode.title) ?? "";
  const originaltitle = toStringValue(movieNode.originaltitle);
  const plot = toStringValue(movieNode.plot);
  const premiered = toStringValue(movieNode.premiered);
  const releasedate = toStringValue(movieNode.releasedate);
  const yearText = toStringValue(movieNode.year);
  const ratingText = toStringValue(movieNode.rating);

  const uniqueidNode = movieNode.uniqueid;
  const uniqueid =
    uniqueidNode && typeof uniqueidNode === "object"
      ? (uniqueidNode as Record<string, unknown>)["#text"]
      : uniqueidNode;
  const number = toStringValue(uniqueid) ?? "";

  const website =
    parseWebsite(movieNode.website) ??
    (uniqueidNode && typeof uniqueidNode === "object"
      ? parseWebsite((uniqueidNode as Record<string, unknown>)["@_type"])
      : null);

  if (!website) {
    throw new Error("NFO missing website");
  }

  if (!title || !number) {
    throw new Error("NFO missing required fields");
  }

  const actorNodes = toArray(movieNode.actor);
  const actors = actorNodes
    .map((node) => {
      if (typeof node === "string") {
        return node;
      }
      if (node && typeof node === "object") {
        const nameValue = (node as Record<string, unknown>).name;
        return toStringValue(nameValue) ?? "";
      }
      return "";
    })
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const actorProfiles = actorNodes
    .map((node): ActorProfile | null => {
      if (!node || typeof node !== "object") {
        return null;
      }

      const name = toStringValue((node as Record<string, unknown>).name);
      if (!name) {
        return null;
      }

      return {
        name,
        aliases: toStringValue((node as Record<string, unknown>).altname)
          ? [toStringValue((node as Record<string, unknown>).altname) as string]
          : undefined,
        description: toStringValue((node as Record<string, unknown>).biography),
        cover_url: toStringValue((node as Record<string, unknown>).thumb),
      };
    })
    .filter((item): item is ActorProfile => item !== null);

  const genres = toArray(movieNode.genre)
    .map((item) => toStringValue(item) ?? "")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const thumbs = parseThumbEntries(movieNode.thumb);
  const posterUrl = pickThumbByAspect(thumbs, ["poster"]);
  const coverUrl =
    pickThumbByAspect(thumbs, ["thumb", "cover"]) ?? thumbs.find((entry) => !entry.aspect)?.value ?? thumbs[0]?.value;

  const fanartThumbs =
    movieNode.fanart && typeof movieNode.fanart === "object"
      ? toArray((movieNode.fanart as Record<string, unknown>).thumb)
          .map((item) => {
            if (typeof item === "string") {
              return toStringValue(item) ?? "";
            }
            if (item && typeof item === "object") {
              return toStringValue((item as Record<string, unknown>)["#text"]) ?? "";
            }
            return "";
          })
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      : [];
  const fanartUrl = fanartThumbs[0];
  const sampleImages = fanartThumbs.slice(1);

  const rating = ratingText ? Number.parseFloat(ratingText) : undefined;
  const releaseYear = yearText ? Number.parseInt(yearText, 10) : undefined;

  return {
    title: originaltitle ?? title,
    title_zh: title,
    number,
    actors,
    actor_profiles: actorProfiles.length > 0 ? actorProfiles : undefined,
    genres,
    studio: toStringValue(movieNode.studio),
    director: toStringValue(movieNode.director),
    publisher: toStringValue(movieNode.publisher),
    series: toStringValue(movieNode.set) ?? toStringValue(movieNode.series),
    plot,
    plot_zh: plot,
    release_date: premiered ?? releasedate,
    release_year: Number.isFinite(releaseYear) ? releaseYear : undefined,
    rating: Number.isFinite(rating) ? rating : undefined,
    cover_url: coverUrl,
    poster_url: posterUrl,
    fanart_url: fanartUrl,
    sample_images: sampleImages,
    trailer_url: toStringValue(movieNode.trailer),
    website,
  };
};
