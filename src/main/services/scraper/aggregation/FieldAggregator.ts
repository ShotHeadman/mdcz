import type { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";

import type { AggregationStrategy, ImageAlternatives, SourceMap } from "./types";
import { FIELD_STRATEGIES } from "./types";

const SCRIPT_PATTERN =
  /(?:<script|<\/script|<style|function\s*\(|=>\s*\{|window\.|document\.\w+\(|var\s+\w+\s*=|const\s+\w+\s*=|let\s+\w+\s*=)/i;

function looksLikeCode(text: string): boolean {
  return SCRIPT_PATTERN.test(text);
}

interface AggregationBehavior {
  preferLongerPlot: boolean;
  maxSceneImages: number;
  maxActors: number;
  maxGenres: number;
}

const DEFAULT_BEHAVIOR: AggregationBehavior = {
  preferLongerPlot: true,
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

function isPrimaryImageField(field: keyof CrawlerData): field is PrimaryImageAlternativeField {
  return field === "thumb_url" || field === "poster_url";
}

/** Selects the best value for each CrawlerData field from multiple sources. */
export class FieldAggregator {
  private readonly behavior: AggregationBehavior;

  constructor(
    private readonly priorities: Partial<Record<string, Website[]>>,
    behavior?: Partial<AggregationBehavior>,
  ) {
    this.behavior = { ...DEFAULT_BEHAVIOR, ...behavior };
  }

  aggregate(results: Map<Website, CrawlerData>): {
    data: CrawlerData;
    sources: SourceMap;
    imageAlternatives: ImageAlternatives;
  } {
    const sources: SourceMap = {};
    const imageAlternatives: ImageAlternatives = {
      ...EMPTY_IMAGE_ALTERNATIVES,
    };

    const entries: SourceEntry[] = Array.from(results.entries()).map(([site, data]) => ({ site, data }));
    if (entries.length === 0) {
      throw new Error("No results to aggregate");
    }

    // Use first entry as fallback for required fields
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
      title_zh: resolve("title_zh"),
      number: resolve("number") || firstEntry.data.number,
      actors: resolve("actors") ?? [],
      genres: resolve("genres") ?? [],
      content_type: resolve("content_type"),
      studio: resolve("studio"),
      director: resolve("director"),
      publisher: resolve("publisher"),
      series: resolve("series"),
      plot: resolve("plot"),
      plot_zh: resolve("plot_zh"),
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
    const remaining = new Set(entries.map((e) => e.site));

    for (const site of priority) {
      const entry = entries.find((e) => e.site === site);
      if (entry) {
        ordered.push(entry);
        remaining.delete(site);
      }
    }

    // Append remaining entries not in priority list
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
      case "longest":
        return this.longest(field, entries);
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
      if (value !== undefined && value !== null && value !== "") {
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
        if (field === "actors") {
          return { value: value.slice(0, this.behavior.maxActors), source: entry.site };
        }

        return { value, source: entry.site };
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

  private longest(field: keyof CrawlerData, entries: SourceEntry[]): ResolvedField {
    let best: { value: string; source: Website } | null = null;

    for (const entry of entries) {
      const value = entry.data[field];
      if (typeof value === "string" && value.length > 0) {
        if (looksLikeCode(value)) continue;
        if (!best || value.length > best.value.length) {
          best = { value, source: entry.site };
        }
      }
    }

    return best ? { value: best.value, source: best.source } : { value: undefined };
  }

  private union(field: keyof CrawlerData, entries: SourceEntry[]): ResolvedField {
    if (field === "actors") {
      return this.unionActors(entries);
    }
    if (field === "genres") {
      return this.unionGenres(entries);
    }
    // Generic array union for unknown fields
    const seen = new Set<string>();
    const merged: unknown[] = [];
    let source: Website | undefined;

    for (const entry of entries) {
      const value = entry.data[field];
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        const key = typeof item === "string" ? item : JSON.stringify(item);
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(item);
          if (!source) source = entry.site;
        }
      }
    }

    return { value: merged.length > 0 ? merged : undefined, source };
  }

  private unionActors(entries: SourceEntry[]): { value: string[]; source?: Website } {
    const seen = new Set<string>();
    const merged: string[] = [];
    let source: Website | undefined;

    for (const entry of entries) {
      for (const actor of entry.data.actors) {
        const normalized = actor.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
        if (!seen.has(normalized)) {
          seen.add(normalized);
          merged.push(actor);
          if (!source) source = entry.site;
        }
      }
    }

    return {
      value: merged.slice(0, this.behavior.maxActors),
      source,
    };
  }
  private unionGenres(entries: SourceEntry[]): { value: string[]; source?: Website } {
    const seen = new Set<string>();
    const merged: string[] = [];
    let source: Website | undefined;

    for (const entry of entries) {
      for (const genre of entry.data.genres) {
        const normalized = genre.normalize("NFKC").toLowerCase().trim();
        if (!seen.has(normalized)) {
          seen.add(normalized);
          merged.push(genre);
          if (!source) source = entry.site;
        }
      }
    }

    return {
      value: merged.slice(0, this.behavior.maxGenres),
      source,
    };
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
      if (typeof value !== "string" || value.length === 0) {
        return [];
      }

      return [{ value, source: entry.site }];
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

    return {
      value: winner.value,
      source: winner.source,
      alternatives,
    };
  }
}
