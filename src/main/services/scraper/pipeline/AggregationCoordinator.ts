import type { Configuration } from "@main/services/config";
import type { FileInfo } from "@shared/types";
import type { AggregationResult, AggregationService } from "../aggregation";
import { isGeneratedSidecarVideo } from "../media";

const AGGREGATION_FAILURE_CACHE_WINDOW_MS = 1000;

export class AggregationCoordinator {
  private readonly aggregationPromiseCache = new Map<string, Promise<AggregationResult | null>>();

  private readonly aggregationFailureEvictionTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly aggregationService: AggregationService) {}

  aggregate(fileInfo: FileInfo, configuration: Configuration, signal?: AbortSignal): Promise<AggregationResult | null> {
    const cacheKey = fileInfo.number.trim().toUpperCase();
    if (!cacheKey || isGeneratedSidecarVideo(fileInfo.filePath)) {
      return this.aggregationService.aggregate(fileInfo.number, configuration, signal);
    }

    const cached = this.aggregationPromiseCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    let request: Promise<AggregationResult | null>;
    request = this.aggregationService.aggregate(fileInfo.number, configuration, signal).catch((error) => {
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
}
