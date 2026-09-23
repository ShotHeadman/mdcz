import { basename, dirname } from "node:path";
import { configManager } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import { OutputLibraryScanner } from "@main/services/library";
import { createDesktopMediaRootService } from "@main/services/mediaRoots";
import { DesktopPersistenceService } from "@main/services/persistence";
import type { SignalService } from "@main/services/SignalService";
import type { ActorSourceProvider } from "@mdcz/runtime/actorSource";
import type { PersistentCooldownStore } from "@mdcz/runtime/cooldown";
import type { CrawlerProvider } from "@mdcz/runtime/crawler";
import type { ConfiguredMediaRootService } from "@mdcz/runtime/library";
import type { NetworkClient } from "@mdcz/runtime/network";
import { type ActorImageService, ScrapeRunner } from "@mdcz/runtime/scrape";
import type { ScraperStartInput } from "@mdcz/shared/ipc-contracts/scraperContract";
import type { ScrapeConfirmUncensoredInput, ScrapeRunSnapshotDto } from "@mdcz/shared/serverDtos";
import type { UncensoredConfirmResponse } from "@mdcz/shared/types";
import { applyDesktopPosterTagBadges, probeVideoMetadataOrWarn } from "./output";
import { resolveSingleFilePaths } from "./pathResolver";
import { ScraperServiceError } from "./ScraperServiceError";
import { translationMappingStore } from "./translationMappingStore";

export interface StartScrapeResult {
  taskId: string;
  totalFiles: number | null;
  snapshot: ScrapeRunSnapshotDto;
}

export class ScraperService {
  private readonly logger = loggerService.getLogger("ScraperService");
  private readonly mediaRoots: ConfiguredMediaRootService;
  private runnerInstance: ScrapeRunner | null = null;
  private runnerInitPromise: Promise<ScrapeRunner> | null = null;

  constructor(
    private readonly signalService: SignalService,
    private readonly sharedNetworkClient: NetworkClient,
    private readonly crawlerProvider: CrawlerProvider,
    private readonly actorImageService: ActorImageService,
    private readonly actorSourceProvider: ActorSourceProvider | undefined,
    private readonly imageHostCooldownStore: PersistentCooldownStore,
    private readonly outputLibraryScanner = new OutputLibraryScanner(),
    private readonly persistenceService = new DesktopPersistenceService(),
    mediaRoots?: ConfiguredMediaRootService,
    private readonly prepareScrapeItem: <T extends { relativePath: string; caseId?: string }>(item: T) => T = (item) =>
      item,
  ) {
    this.mediaRoots = mediaRoots ?? createDesktopMediaRootService(this.persistenceService);
  }

  private async runner(): Promise<ScrapeRunner> {
    if (this.runnerInstance) return this.runnerInstance;
    this.runnerInitPromise ??= (async () => {
      const state = await this.persistenceService.initialize();
      this.runnerInstance = new ScrapeRunner({
        persistence: {
          scrapeRuns: state.repositories.scrapeRuns,
          library: state.repositories.library,
          mediaRoots: this.mediaRoots,
        },
        getConfiguration: async () => await configManager.getValidated(),
        networkClient: this.sharedNetworkClient,
        crawlerProvider: this.crawlerProvider,
        imageHostCooldownStore: this.imageHostCooldownStore,
        actorImageService: this.actorImageService,
        actorSourceProvider: this.actorSourceProvider,
        mappingStore: translationMappingStore,
        platform: "desktop",
        logger: this.logger,
        probeVideoMetadata: async (sourceVideoPath) =>
          await probeVideoMetadataOrWarn({ logger: this.logger, sourceVideoPath, warningPrefix: "Video probe failed" }),
        postProcessAssets: async ({
          assets,
          configuration,
          crawlerData,
          fileInfo,
          localState,
          signal,
          signalService,
        }) =>
          await applyDesktopPosterTagBadges({
            assets,
            config: configuration,
            crawlerData,
            fileInfo,
            localState,
            logger: this.logger,
            signal,
            signalService,
          }),
        prepareScrapeItem: this.prepareScrapeItem,
        onInvalidate: (runs) => {
          const live = runs[0];
          this.signalService.publishTaskSnapshot({
            resource: "scrape",
            snapshot: live ? live.snapshot : null,
          });
        },
        onTerminal: async (_run, snapshot) => {
          this.signalService.publishTaskSnapshot({ resource: "scrape", snapshot });
          this.outputLibraryScanner.invalidate();
          this.signalService.invalidate("scrape", "overview");
        },
        onError: async (runId, error) => {
          this.logger.error(`Scrape execution failed for ${runId}`, error);
        },
      });
      return this.runnerInstance;
    })().finally(() => {
      this.runnerInitPromise = null;
    });
    return await this.runnerInitPromise;
  }

  async getSnapshot(taskId?: string): Promise<ScrapeRunSnapshotDto | null> {
    return await (await this.runner()).getSnapshot(taskId);
  }

  async confirmUncensored(input: ScrapeConfirmUncensoredInput): Promise<UncensoredConfirmResponse> {
    try {
      return await (await this.runner()).confirmUncensored(input);
    } finally {
      const snapshot = await (await this.runner()).getSnapshot();
      if (snapshot) this.signalService.publishTaskSnapshot({ resource: "scrape", snapshot });
      this.outputLibraryScanner.invalidate();
      this.signalService.invalidate("scrape", "overview");
    }
  }

  async start(input: ScraperStartInput): Promise<StartScrapeResult> {
    try {
      const runner = await this.runner();
      const result = await runner.start(input);
      this.signalService.invalidate("scrape", "overview");
      return result;
    } catch (error) {
      if (error instanceof Error && error.message === "No files selected") {
        throw new ScraperServiceError("NO_FILES", error.message);
      }
      throw error;
    }
  }

  async startFromNativePath(nativePath: string): Promise<StartScrapeResult> {
    const files = await resolveSingleFilePaths([nativePath]);
    const filePath = files[0];
    if (!filePath) throw new ScraperServiceError("NO_FILES", "No files selected");
    const admitted = await this.mediaRoots.admitDirectory({ hostPath: dirname(filePath) });
    return await this.start({
      mode: "single",
      ref: {
        rootId: admitted.root.id,
        relativePath: [admitted.relativeDirectory, basename(filePath)].filter(Boolean).join("/"),
      },
    });
  }

  async stop(): Promise<{ pendingCount: number }> {
    const runner = await this.runner();
    const result = await runner.stop();
    this.signalService.invalidate("scrape", "overview");
    return { pendingCount: result.pendingCount };
  }

  async waitForIdle(): Promise<void> {
    await (await this.runner()).waitForIdle();
  }

  async shutdown(options: { timeoutMs?: number } = {}): Promise<void> {
    await (await this.runner()).shutdown(options);
  }

  async pause(): Promise<void> {
    await (await this.runner()).pause();
  }

  async resume(): Promise<void> {
    await (await this.runner()).resume();
  }

  async retry(runId: string, itemIds?: readonly string[]): Promise<StartScrapeResult> {
    try {
      const result = await (await this.runner()).retry(runId, itemIds);
      this.signalService.invalidate("scrape", "overview");
      return result;
    } catch (error) {
      if (error instanceof Error && error.message === "No scrape run selected") {
        throw new ScraperServiceError("NO_FILES", error.message);
      }
      throw error;
    }
  }

  async rerunDirectory(runId: string): Promise<StartScrapeResult> {
    try {
      const result = await (await this.runner()).rerunDirectory(runId);
      this.signalService.invalidate("scrape", "overview");
      return result;
    } catch (error) {
      if (error instanceof Error && error.message === "No scrape run selected") {
        throw new ScraperServiceError("NO_FILES", error.message);
      }
      throw error;
    }
  }
}
