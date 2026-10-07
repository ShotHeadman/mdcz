import { normalizeActorName } from "@mdcz/shared/actorAliases";
import type { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import type { ImageAlternatives, SiteCrawlResult, SourceMap } from "./aggregation";

export type AggregationStrategy = "first_non_null" | "first_non_empty" | "union" | "highest_quality";

export const FIELD_STRATEGIES: Partial<Record<keyof CrawlerData, AggregationStrategy>> = {
  title: "first_non_null",
  number: "first_non_null",
  studio: "first_non_null",
  director: "first_non_null",
  publisher: "first_non_null",
  series: "first_non_null",
  release_date: "first_non_null",
  durationSeconds: "first_non_null",
  rating: "first_non_null",
  thumb_url: "highest_quality",
  poster_url: "highest_quality",
  fanart_url: "first_non_null",
  trailer_url: "first_non_null",
  website: "first_non_null",
  content_type: "first_non_null",
  plot: "first_non_null",
  actors: "union",
  genres: "first_non_empty",
  scene_images: "first_non_empty",
};

const SCRIPT_PATTERN =
  /(?:<script|<\/script|<style|function\s*\(|=>\s*\{|window\.|document\.\w+\(|var\s+\w+\s*=|const\s+\w+\s*=|let\s+\w+\s*=)/i;

interface AggregationBehavior {
  maxSceneImages: number;
  maxActors: number;
  maxGenres: number;
}

const DEFAULT_BEHAVIOR: AggregationBehavior = {
  maxSceneImages: 30,
  maxActors: 50,
  maxGenres: 30,
};

type SourceEntry = { site: Website; data: CrawlerData };
type ResolvedField = {
  value: unknown;
  source?: Website;
  alternatives?: string[];
  sceneImageAlternatives?: string[][];
  sceneImageAlternativeSources?: Website[];
};

const EMPTY_IMAGE_ALTERNATIVES: ImageAlternatives = {
  thumb_url: [],
  poster_url: [],
  scene_images: [],
  scene_image_sources: [],
};

type PrimaryImageAlternativeField = "thumb_url" | "poster_url";

const looksLikeCode = (text: string): boolean => SCRIPT_PATTERN.test(text);
// DMM credits some actresses as "名義（別名）" (SNOS-055: 及川美桜（夏生なつ）); either name identifies her elsewhere.
const actorIdentityNames = (actor: string): string[] => {
  const normalized = normalizeActorName(actor);
  const credited = normalized.match(/^(.+)\((.+)\)$/u);
  return [normalized, ...(credited ? [credited[1], credited[2]] : [])].filter(Boolean);
};
const isPrimaryImageField = (field: keyof CrawlerData): field is PrimaryImageAlternativeField =>
  field === "thumb_url" || field === "poster_url";

export const summarizeFailedSiteResults = (number: string, siteResults: readonly SiteCrawlResult[]): string => {
  const reasons = siteResults
    .filter((result) => result.status !== "success")
    .map(({ site, status, reason, skipReason }) =>
      status === "failed"
        ? `${site}: ${reason}`
        : `${site}: skipped (${[skipReason, reason].filter(Boolean).join(", ")})`,
    );

  if (reasons.length === 0) {
    return `No crawler returned metadata for ${number}`;
  }

  return `No crawler returned metadata for ${number}. ${reasons.join("; ")}`;
};

export class FieldAggregator {
  private readonly behavior: AggregationBehavior;

  constructor(
    private readonly priorities: Partial<Record<string, Website[]>>,
    behavior?: Partial<AggregationBehavior>,
  ) {
    this.behavior = { ...DEFAULT_BEHAVIOR, ...behavior };
  }

  aggregate(results: ReadonlyMap<Website, CrawlerData>): {
    data: CrawlerData;
    sources: SourceMap;
    imageAlternatives: ImageAlternatives;
  } {
    const sources: SourceMap = {};
    const imageAlternatives: ImageAlternatives = { ...EMPTY_IMAGE_ALTERNATIVES };
    const entries: SourceEntry[] = Array.from(results.entries()).map(([site, data]) => ({ site, data }));
    if (entries.length === 0) {
      throw new Error("No results to aggregate");
    }

    const firstEntry = entries[0];
    const resolve = <K extends keyof CrawlerData>(field: K): CrawlerData[K] => {
      const strategy = FIELD_STRATEGIES[field] ?? "first_non_null";
      const priority = (this.priorities[field] ?? []) as Website[];
      const ordered = this.orderByPriority(entries, priority);
      const result = this.applyStrategy(field, strategy, ordered);
      if (isPrimaryImageField(field)) {
        imageAlternatives[field] = result.alternatives ?? [];
      } else if (field === "scene_images") {
        imageAlternatives.scene_images = result.sceneImageAlternatives ?? [];
        imageAlternatives.scene_images_source = result.source;
        imageAlternatives.scene_image_sources = result.sceneImageAlternativeSources ?? [];
      }
      if (result.value !== undefined && result.value !== null) {
        sources[field] = result.source;
      }
      return result.value as CrawlerData[K];
    };

    const data: CrawlerData = {
      title: resolve("title") || firstEntry.data.title,
      number: resolve("number") || firstEntry.data.number,
      actors: resolve("actors") ?? [],
      genres: resolve("genres") ?? [],
      content_type: resolve("content_type"),
      studio: resolve("studio"),
      director: resolve("director"),
      publisher: resolve("publisher"),
      series: resolve("series"),
      plot: resolve("plot"),
      release_date: resolve("release_date"),
      durationSeconds: resolve("durationSeconds"),
      rating: resolve("rating"),
      thumb_url: resolve("thumb_url"),
      poster_url: resolve("poster_url"),
      fanart_url: resolve("fanart_url"),
      scene_images: resolve("scene_images") ?? [],
      trailer_url: resolve("trailer_url"),
      website: resolve("website") ?? firstEntry.data.website,
    };

    return { data, sources, imageAlternatives };
  }

  private orderByPriority(entries: SourceEntry[], priority: Website[]): SourceEntry[] {
    if (priority.length === 0) {
      return entries;
    }

    const ordered: SourceEntry[] = [];
    const remaining = new Set(entries.map((entry) => entry.site));
    for (const site of priority) {
      const entry = entries.find((item) => item.site === site);
      if (entry) {
        ordered.push(entry);
        remaining.delete(site);
      }
    }
    for (const entry of entries) {
      if (remaining.has(entry.site)) {
        ordered.push(entry);
      }
    }
    return ordered;
  }

  private applyStrategy(
    field: keyof CrawlerData,
    strategy: AggregationStrategy,
    entries: SourceEntry[],
  ): ResolvedField {
    switch (strategy) {
      case "first_non_null":
        return this.firstNonNull(field, entries);
      case "first_non_empty":
        return this.firstNonEmpty(field, entries);
      case "union":
        return this.union(field, entries);
      case "highest_quality":
        return this.highestQuality(field, entries);
      default:
        return this.firstNonNull(field, entries);
    }
  }

  private firstNonNull(field: keyof CrawlerData, entries: SourceEntry[]): ResolvedField {
    for (const entry of entries) {
      const value = entry.data[field];
      if (
        value !== undefined &&
        value !== null &&
        value !== "" &&
        !(typeof value === "string" && looksLikeCode(value))
      ) {
        return { value, source: entry.site };
      }
    }
    return { value: undefined };
  }

  private firstNonEmpty(field: keyof CrawlerData, entries: SourceEntry[]): ResolvedField {
    if (field === "scene_images") {
      return this.firstNonEmptySceneImages(entries);
    }

    for (const entry of entries) {
      const value = entry.data[field];
      if (Array.isArray(value) && value.length > 0) {
        return { value: field === "genres" ? value.slice(0, this.behavior.maxGenres) : value, source: entry.site };
      }
      if (typeof value === "string" && value.length > 0) {
        return { value, source: entry.site };
      }
    }
    return { value: undefined };
  }

  private firstNonEmptySceneImages(entries: SourceEntry[]): ResolvedField {
    const alternatives: string[][] = [];
    const alternativeSources: Website[] = [];
    const seenSets = new Set<string>();
    let winner: string[] | undefined;
    let source: Website | undefined;

    for (const entry of entries) {
      const urls = this.normalizeSceneImageSet(entry.data.scene_images);
      if (urls.length === 0) {
        continue;
      }
      const signature = JSON.stringify(urls);
      if (!winner) {
        winner = urls;
        source = entry.site;
        seenSets.add(signature);
        continue;
      }
      if (seenSets.has(signature)) {
        continue;
      }
      seenSets.add(signature);
      alternatives.push(urls);
      alternativeSources.push(entry.site);
    }

    return {
      value: winner,
      source,
      sceneImageAlternatives: alternatives,
      sceneImageAlternativeSources: alternativeSources,
    };
  }

  private union(field: keyof CrawlerData, entries: SourceEntry[]): ResolvedField {
    if (field !== "actors") throw new Error(`No union rule for ${field}`);
    const seen = new Set<string>();
    const merged: string[] = [];
    let source: Website | undefined;
    for (const entry of entries) {
      for (const actor of entry.data.actors) {
        const names = actorIdentityNames(actor);
        const known = names.some((name) => seen.has(name));
        for (const name of names) seen.add(name);
        if (known || names.length === 0) continue;
        merged.push(actor);
        source ??= entry.site;
      }
    }
    return { value: merged.slice(0, this.behavior.maxActors), source };
  }

  private normalizeSceneImageSet(values: string[]): string[] {
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const value of values) {
      const normalized = value.trim();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      urls.push(normalized);
      if (urls.length >= this.behavior.maxSceneImages) {
        break;
      }
    }
    return urls;
  }

  private highestQuality(field: keyof CrawlerData, entries: SourceEntry[]): ResolvedField {
    const candidates = entries.flatMap((entry) => {
      const value = entry.data[field];
      return typeof value === "string" && value.length > 0 ? [{ value, source: entry.site }] : [];
    });
    if (candidates.length === 0) {
      return { value: undefined, alternatives: [] };
    }

    const winner = candidates.find((candidate) => candidate.value.includes("awsimgsrc.dmm.co.jp")) ?? candidates[0];
    const seen = new Set<string>([winner.value]);
    const alternatives: string[] = [];
    for (const candidate of candidates) {
      if (seen.has(candidate.value)) {
        continue;
      }
      seen.add(candidate.value);
      alternatives.push(candidate.value);
    }
    return { value: winner.value, source: winner.source, alternatives };
  }
}
