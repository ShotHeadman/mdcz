import { loggerService } from "@main/services/LoggerService";
import type { DesktopPersistenceService } from "@main/services/persistence";
import { toErrorMessage } from "@main/utils/common";
import {
  createEmptyOutputLibrarySummary,
  createOutputLibrarySummaryFromEntries,
  createOutputLibrarySummaryFromScrapeOutput,
  type RuntimeOutputLibrarySummary,
} from "@mdcz/runtime/library";

export type OutputLibrarySummary = RuntimeOutputLibrarySummary;

interface OutputLibraryScannerLogger {
  warn(message: string): void;
}

interface OutputLibraryScannerOptions {
  ttlMs?: number;
  now?: () => number;
  logger?: OutputLibraryScannerLogger;
  persistenceService?: DesktopPersistenceService;
}

const DEFAULT_CACHE_TTL_MS = 60_000;

export class OutputLibraryScanner {
  private readonly ttlMs: number;

  private readonly now: () => number;

  private readonly logger: OutputLibraryScannerLogger;

  private readonly persistenceService: DesktopPersistenceService | undefined;

  private cachedSummary: OutputLibrarySummary | null = null;

  private cacheExpiresAt = 0;

  constructor(options: OutputLibraryScannerOptions = {}) {
    this.ttlMs = Math.max(0, Math.trunc(options.ttlMs ?? DEFAULT_CACHE_TTL_MS));
    this.now = options.now ?? Date.now;
    this.logger = options.logger ?? loggerService.getLogger("OutputLibraryScanner");
    this.persistenceService = options.persistenceService;
  }

  invalidate(): void {
    this.cachedSummary = null;
    this.cacheExpiresAt = 0;
  }

  async getSummary(): Promise<OutputLibrarySummary> {
    const now = this.now();
    if (this.cachedSummary && now < this.cacheExpiresAt) {
      return this.cachedSummary;
    }

    const summary = await this.scan(now);
    this.cachedSummary = summary;
    this.cacheExpiresAt = now + this.ttlMs;
    return summary;
  }

  private async scan(scannedAt: number): Promise<OutputLibrarySummary> {
    if (!this.persistenceService) {
      return createEmptyOutputLibrarySummary(scannedAt);
    }

    try {
      const state = await this.persistenceService.getState();
      const latestOutput = await state.repositories.library.latestScrapeOutput();
      if (latestOutput) {
        return createOutputLibrarySummaryFromScrapeOutput(latestOutput, scannedAt);
      }
      const entries = await state.repositories.library.listEntries();
      return createOutputLibrarySummaryFromEntries(entries, scannedAt);
    } catch (error) {
      const message = toErrorMessage(error);
      this.logger.warn(`Failed to read persisted output library summary: ${message}`);
      return createEmptyOutputLibrarySummary(scannedAt);
    }
  }
}
