import path from "node:path";
import type { MediaRoot } from "@mdcz/media-store";
import { resolveRootRelativePath } from "@mdcz/media-store";
import type { Configuration } from "@mdcz/shared/config";
import type { CrawlerData, FileInfo, NfoLocalState, ScrapeResult } from "@mdcz/shared/types";
import { NetworkClient, type RuntimeDownloadNetworkClient } from "../network";
import type { PublicationPlan } from "../publication";
import { ActorImageService } from "./ActorImageService";
import type { RuntimeActorSourceProvider } from "./actorOutput";
import type { AggregationResult, ManualScrapeOptions } from "./aggregation";
import { DownloadManager, type ImageHostCooldownStore, MemoryImageHostCooldownStore } from "./download";
import { FileOrganizer } from "./FileOrganizer";
import { FileScraper, type RuntimeScrapeSignalService } from "./FileScraper";
import { NfoGenerator } from "./nfo";
import { applyPosterTagBadgesIfNeeded } from "./output/applyPosterTagBadges";
import { PosterWatermarkService } from "./PosterWatermarkService";
import { TranslateService } from "./TranslateService";
import type { TranslationMappingStore } from "./translate/types";

interface MountedRootScrapeLogger {
  debug?(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

const toRuntimeLogger = (logger: MountedRootScrapeLogger) => ({
  debug: (message: string) => logger.debug?.(message),
  info: (message: string) => logger.info(message),
  warn: (message: string) => logger.warn(message),
  error: (message: string) => logger.error(message),
});

export interface MountedRootScrapeRuntimeConfig {
  runtimePaths: { dataDir: string };
  get(): Promise<Configuration>;
}

export interface MountedRootScrapeAggregationService {
  aggregate(
    number: string,
    configuration: Configuration,
    signal?: AbortSignal,
    manualScrape?: ManualScrapeOptions,
  ): Promise<AggregationResult | null>;
  getFailureSummary?(number: string): string | undefined;
}

export interface MountedRootScrapeRuntimeItemInput {
  root: MediaRoot;
  outputRoot?: MediaRoot;
  relativePath: string;
  scrapeSessionId?: string;
  manualScrape?: ManualScrapeOptions;
  localState?: NfoLocalState;
  operationId?: string;
  publicationRoots?: MediaRoot[];
  progress: { fileIndex: number; totalFiles: number };
  onEvent?: (type: string, message: string) => Promise<void> | void;
  onProgress?: (progress: { value: number; current: number; total: number }) => Promise<void> | void;
  onStage?: (stage: "search" | "download" | "parse" | "organize", message: string) => Promise<void> | void;
  signal?: AbortSignal;
}

export interface MountedRootScrapeRuntimeItemSuccess {
  status: "success";
  result: ScrapeResult;
  crawlerData: CrawlerData;
  nfoPath: string | null;
  outputRelativePath: string;
  size: number;
  modifiedAt: Date | null;
  plan: PublicationPlan;
}

export interface MountedRootScrapeRuntimeItemFailure {
  status: "failed" | "skipped";
  result: ScrapeResult;
  error: string;
}

export type MountedRootScrapeRuntimeItemResult =
  | MountedRootScrapeRuntimeItemSuccess
  | MountedRootScrapeRuntimeItemFailure;

class MountedRootScrapeSignalService implements RuntimeScrapeSignalService {
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly input: MountedRootScrapeRuntimeItemInput) {}

  showFailedInfo(_input: { fileInfo: FileInfo; error: string }): void {}

  showLogText(message: string): void {
    console.info(message);
    this.track(this.input.onEvent?.("log", message));
  }

  showScrapeInfo(input: {
    fileInfo: FileInfo;
    site: CrawlerData["website"];
    step: "search" | "download" | "parse" | "organize";
  }): void {
    this.track(
      this.input.onStage?.(input.step, `${input.fileInfo.fileName}${input.fileInfo.extension}: ${input.site}`),
    );
  }

  showScrapeResult(_result: ScrapeResult): void {}

  setProgress(value: number, current: number, total: number): void {
    this.track(this.input.onProgress?.({ value, current, total }));
  }

  async flush(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  private track(result: Promise<void> | void): void {
    if (!result) return;
    this.pending.add(result);
    result.finally(() => this.pending.delete(result));
  }
}

export class MountedRootScrapeRuntime {
  constructor(
    private readonly config: MountedRootScrapeRuntimeConfig,
    private readonly aggregationService: MountedRootScrapeAggregationService,
    private readonly logger: MountedRootScrapeLogger = console,
    private readonly networkClient?: RuntimeDownloadNetworkClient,
    private readonly mappingStore?: TranslationMappingStore,
    private readonly imageHostCooldownStore?: ImageHostCooldownStore,
    private readonly actorSourceProvider?: RuntimeActorSourceProvider,
  ) {}

  async scrape(input: MountedRootScrapeRuntimeItemInput): Promise<MountedRootScrapeRuntimeItemResult> {
    const signalService = new MountedRootScrapeSignalService(input);
    const networkClient = this.networkClient ?? new NetworkClient();
    const runtimeLogger = toRuntimeLogger(this.logger);
    const fileOrganizer = new FileOrganizer(runtimeLogger);
    const actorImageService = new ActorImageService({
      cacheRoot: path.join(this.config.runtimePaths.dataDir, "actor-image-cache"),
      logger: runtimeLogger,
      networkClient,
    });
    const scraper = new FileScraper({
      actorImageService,
      actorSourceProvider: this.actorSourceProvider,
      aggregationService: this.aggregationService,
      downloadManager: new DownloadManager(networkClient, {
        imageHostCooldownStore: this.imageHostCooldownStore ?? new MemoryImageHostCooldownStore(),
        logger: runtimeLogger,
      }),
      fileOrganizer,
      getConfiguration: async () => {
        const configuration = await this.config.get();
        return {
          ...configuration,
          paths: { ...configuration.paths, mediaPath: (input.outputRoot ?? input.root).hostPath },
        };
      },
      loadExistingNfoLocalState: async () => input.localState,
      logger: this.logger,
      nfoGenerator: new NfoGenerator(),
      postProcessAssets: async ({ assets, configuration, crawlerData, fileInfo, localState, signal }) =>
        await applyPosterTagBadgesIfNeeded({
          assets,
          config: configuration,
          crawlerData,
          dataDir: this.config.runtimePaths.dataDir,
          fileInfo,
          localState,
          logger: this.logger,
          signal,
          signalService,
          watermarkService: new PosterWatermarkService({ dataDir: this.config.runtimePaths.dataDir }),
        }),
      signalService,
      translateService: new TranslateService(networkClient, { logger: runtimeLogger, mappingStore: this.mappingStore }),
    });

    try {
      const roots = input.publicationRoots?.length
        ? input.publicationRoots
        : [input.root, input.outputRoot].filter((root): root is MediaRoot => Boolean(root));
      const result = await scraper.scrapeFile(
        resolveRootRelativePath(input.root, input.relativePath),
        input.progress,
        input.signal,
        {
          manualScrape: input.manualScrape,
          scrapeSessionId: input.scrapeSessionId,
          source: { rootId: input.root.id, relativePath: input.relativePath },
          roots,
          operationId: input.operationId ?? `${input.scrapeSessionId ?? "scrape"}:${input.relativePath}`,
        },
      );
      if (result.status !== "success" || !result.crawlerData) {
        return {
          status: result.status === "skipped" ? "skipped" : "failed",
          result,
          error: result.error ?? "刮削失败",
        };
      }
      if (!result.publicationPlan?.video) throw new Error("Successful scrape did not produce a publication plan");
      const video = result.publicationPlan.video;
      return {
        status: "success",
        result,
        crawlerData: result.crawlerData,
        nfoPath: result.nfo
          ? resolveRootRelativePath(
              roots.find((root) => root.id === result.nfo?.rootId) ?? input.root,
              result.nfo.relativePath,
            )
          : null,
        outputRelativePath: video.target.relativePath,
        size: video.size,
        modifiedAt: null,
        plan: result.publicationPlan,
      };
    } finally {
      await signalService.flush();
    }
  }
}
