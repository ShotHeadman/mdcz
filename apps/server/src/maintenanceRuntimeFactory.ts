import path from "node:path";
import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import { MaintenanceRuntime } from "@mdcz/runtime/maintenance";
import { NetworkClient } from "@mdcz/runtime/network";
import {
  ActorImageService,
  AggregationService,
  DownloadManager,
  FileOrganizer,
  NfoGenerator,
  TranslateService,
} from "@mdcz/runtime/scrape";
import { runtimeLoggerService } from "@mdcz/runtime/shared";
import type { TranslationMappingStore } from "@mdcz/runtime/translate";
import type { ServerConfigService } from "./services/configService";

class MemoryImageHostCooldownStore {
  private readonly entries = new Map<string, { failures: number[]; cooldownUntil?: number }>();

  getActiveCooldown(key: string): { cooldownUntil: number; remainingMs: number } | null {
    const cooldownUntil = this.entries.get(key)?.cooldownUntil;
    if (!cooldownUntil) return null;
    const remainingMs = cooldownUntil - Date.now();
    if (remainingMs <= 0) {
      this.reset(key);
      return null;
    }
    return { cooldownUntil, remainingMs };
  }

  isCoolingDown(key: string): boolean {
    return this.getActiveCooldown(key) !== null;
  }

  recordFailure(
    key: string,
    policy: { threshold: number; windowMs: number; cooldownMs: number },
  ): { cooldownUntil?: number | null; failureCount: number } {
    const now = Date.now();
    const entry = this.entries.get(key) ?? { failures: [] };
    const failures = [...entry.failures.filter((timestamp) => now - timestamp <= policy.windowMs), now];
    const cooldownUntil = failures.length >= policy.threshold ? now + policy.cooldownMs : entry.cooldownUntil;
    this.entries.set(key, { failures, cooldownUntil });
    return { cooldownUntil, failureCount: failures.length };
  }

  reset(key: string): void {
    this.entries.delete(key);
  }
}

export const createServerMaintenanceRuntime = (
  config: ServerConfigService,
  mappingStore?: TranslationMappingStore,
): MaintenanceRuntime => {
  const networkClient = new NetworkClient();
  const logger = runtimeLoggerService.getLogger("maintenance");
  return new MaintenanceRuntime({
    actorImageService: new ActorImageService({
      cacheRoot: path.join(config.runtimePaths.dataDir, "actor-image-cache"),
      logger,
      networkClient,
    }),
    aggregationService: new AggregationService(
      new CrawlerProvider({ fetchGateway: new FetchGateway(networkClient), siteRequestConfigRegistrar: networkClient }),
      { logger },
    ),
    config,
    downloadManager: new DownloadManager(networkClient, {
      imageHostCooldownStore: new MemoryImageHostCooldownStore(),
      logger,
    }),
    fileOrganizer: new FileOrganizer(logger),
    nfoGenerator: new NfoGenerator(),
    signalService: {
      setProgress: () => undefined,
      showLogText: () => undefined,
    },
    translateService: new TranslateService(networkClient, { logger, mappingStore }),
  });
};
