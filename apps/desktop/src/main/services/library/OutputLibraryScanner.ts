import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { type Configuration, configManager } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import { toErrorMessage } from "@main/utils/common";
import { listVideoFiles } from "@main/utils/file";

export interface OutputLibrarySummary {
  fileCount: number;
  totalBytes: number;
  scannedAt: number;
  rootPath: string | null;
}

interface OutputLibraryScannerLogger {
  warn(message: string): void;
}

interface OutputLibraryScannerOptions {
  ttlMs?: number;
  now?: () => number;
  configProvider?: () => Promise<Configuration>;
  logger?: OutputLibraryScannerLogger;
}

const DEFAULT_CACHE_TTL_MS = 60_000;

export class OutputLibraryScanner {
  private readonly ttlMs: number;

  private readonly now: () => number;

  private readonly configProvider: () => Promise<Configuration>;

  private readonly logger: OutputLibraryScannerLogger;

  private cachedSummary: OutputLibrarySummary | null = null;

  private cacheExpiresAt = 0;

  constructor(options: OutputLibraryScannerOptions = {}) {
    this.ttlMs = Math.max(0, Math.trunc(options.ttlMs ?? DEFAULT_CACHE_TTL_MS));
    this.now = options.now ?? Date.now;
    this.configProvider = options.configProvider ?? (() => configManager.getValidated());
    this.logger = options.logger ?? loggerService.getLogger("OutputLibraryScanner");
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
    const configuration = await this.configProvider();
    const rootPath = await this.resolveRootPath(configuration);
    if (!rootPath) {
      return {
        fileCount: 0,
        totalBytes: 0,
        scannedAt,
        rootPath: null,
      };
    }

    let files: string[];
    try {
      files = await listVideoFiles(rootPath, true);
    } catch (error) {
      const message = toErrorMessage(error);
      this.logger.warn(`Failed to scan output library at ${rootPath}: ${message}`);
      return {
        fileCount: 0,
        totalBytes: 0,
        scannedAt,
        rootPath: null,
      };
    }

    const sizes = await Promise.all(files.map((filePath) => this.getFileSize(filePath)));
    return {
      fileCount: files.length,
      totalBytes: sizes.reduce((sum, size) => sum + size, 0),
      scannedAt,
      rootPath,
    };
  }

  private async resolveRootPath(configuration: Configuration): Promise<string | null> {
    const rootPath = this.resolveConfiguredRootPath(configuration);
    if (!rootPath) {
      return null;
    }

    try {
      const stats = await stat(rootPath);
      return stats.isDirectory() ? rootPath : null;
    } catch {
      return null;
    }
  }

  private resolveConfiguredRootPath(configuration: Configuration): string | null {
    const explicitPath = configuration.paths.outputSummaryPath.trim();
    return explicitPath.length > 0
      ? explicitPath
      : this.resolveDefaultOutputPath(configuration.paths.mediaPath, configuration.paths.successOutputFolder);
  }

  private resolveDefaultOutputPath(mediaPath: string, successOutputFolder: string): string | null {
    const mediaRoot = mediaPath.trim();
    const successFolder = successOutputFolder.trim();
    if (!mediaRoot || !successFolder) {
      return null;
    }

    return resolve(mediaRoot, successFolder);
  }

  private async getFileSize(filePath: string): Promise<number> {
    try {
      const stats = await stat(filePath);
      return stats.isFile() ? stats.size : 0;
    } catch (error) {
      const message = toErrorMessage(error);
      this.logger.warn(`Failed to stat output library file ${filePath}: ${message}`);
      return 0;
    }
  }
}
