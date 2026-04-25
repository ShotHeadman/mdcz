import type { Configuration } from "@main/services/config";
import type { FileInfo } from "@shared/types";
import type { AggregationResult, AggregationService } from "../aggregation";
import type { ManualScrapeOptions } from "../manualScrape";
import { isGeneratedSidecarVideo } from "../media";

const AGGREGATION_FAILURE_CACHE_WINDOW_MS = 1000;

export class AggregationCoordinator {
  private readonly aggregationPromiseCache = new Map<string, Promise<AggregationResult | null>>();

  private readonly aggregationFailureEvictionTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly aggregationService: AggregationService) {}

  aggregate(
    fileInfo: FileInfo,
    configuration: Configuration,
    signal?: AbortSignal,
    manualScrape?: ManualScrapeOptions,
  ): Promise<AggregationResult | null> {
    const cacheKey = this.buildCacheKey(fileInfo, manualScrape);
    if (!cacheKey || isGeneratedSidecarVideo(fileInfo.filePath)) {
      return this.aggregationService.aggregate(fileInfo.number, configuration, signal, manualScrape);
    }

    const cached = this.aggregationPromiseCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    let request: Promise<AggregationResult | null>;
    request = this.aggregationService.aggregate(fileInfo.number, configuration, signal, manualScrape).catch((error) => {
      this.scheduleFailedAggregationEviction(cacheKey, request);
      throw error;
    });
    this.aggregationPromiseCache.set(cacheKey, request);
    return request;
  }

  private scheduleFailedAggregationEviction(cacheKey: string, request: Promise<AggregationResult | null>): void {
    const existingTimer = this.aggregationFailureEvictionTimers.get(cacheKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      if (this.aggregationPromiseCache.get(cacheKey) === request) {
        this.aggregationPromiseCache.delete(cacheKey);
      }
      this.aggregationFailureEvictionTimers.delete(cacheKey);
    }, AGGREGATION_FAILURE_CACHE_WINDOW_MS);
    timer.unref?.();
    this.aggregationFailureEvictionTimers.set(cacheKey, timer);
  }

  private buildCacheKey(fileInfo: FileInfo, manualScrape?: ManualScrapeOptions): string {
    const number = fileInfo.number.trim().toUpperCase();
    if (!manualScrape) {
      return number;
    }

    return `${number}::manual::${manualScrape.site}::${manualScrape.detailUrl ?? ""}`;
  }
}
