import type { MediaRoot } from "@mdcz/media-store";
import { resolveRootRelativePath } from "@mdcz/media-store";
import type { Configuration } from "@mdcz/shared/config";
import type { CrawlerData, FileInfo, NfoLocalState, ScrapeResult } from "@mdcz/shared/types";
import type { RuntimeDownloadNetworkClient } from "../network";
import type { PublicationPlan } from "../publication";
import type { ActorImageService } from "./ActorImageService";
import type { RuntimeActorSourceProvider } from "./actorOutput";
import type { AggregationResult, ManualScrapeOptions } from "./aggregation";
import { DownloadManager, type ImageHostCooldownStore } from "./download";
import { FileOrganizer, type ScrapeExecutionMode } from "./FileOrganizer";
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
  outputRelativeDirectory?: string;
  executionMode: ScrapeExecutionMode;
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

export interface MountedRootScrapeRuntimeDependencies {
  config: MountedRootScrapeRuntimeConfig;
  aggregationService: MountedRootScrapeAggregationService;
  networkClient: RuntimeDownloadNetworkClient;
  logger?: MountedRootScrapeLogger;
  mappingStore?: TranslationMappingStore;
  imageHostCooldownStore: ImageHostCooldownStore;
  actorSourceProvider?: RuntimeActorSourceProvider;
  actorImageService: ActorImageService;
}

export class MountedRootScrapeRuntime {
  constructor(private readonly deps: MountedRootScrapeRuntimeDependencies) {}

  async scrape(input: MountedRootScrapeRuntimeItemInput): Promise<MountedRootScrapeRuntimeItemResult> {
    const signalService = new MountedRootScrapeSignalService(input);
    const { config, aggregationService, networkClient, mappingStore, imageHostCooldownStore, actorSourceProvider } =
      this.deps;
    const logger = this.deps.logger ?? console;
    const runtimeLogger = toRuntimeLogger(logger);
    const fileOrganizer = new FileOrganizer(runtimeLogger);
    const { actorImageService } = this.deps;
    const scraper = new FileScraper(
      {
        actorImageService,
        actorSourceProvider,
        aggregationService,
        downloadManager: new DownloadManager(networkClient, {
          imageHostCooldownStore,
          logger: runtimeLogger,
        }),
        fileOrganizer,
        getConfiguration: async () => {
          const configuration = await config.get();
          return {
            ...configuration,
            paths: {
              ...configuration.paths,
              mediaPath: (input.outputRoot ?? input.root).hostPath,
              ...(input.outputRoot ? { successOutputFolder: input.outputRelativeDirectory ?? "" } : {}),
            },
          };
        },
        loadExistingNfoLocalState: async () => input.localState,
        logger,
        nfoGenerator: new NfoGenerator(),
        postProcessAssets: async ({ assets, configuration, crawlerData, fileInfo, localState, signal }) =>
          await applyPosterTagBadgesIfNeeded({
            assets,
            config: configuration,
            crawlerData,
            dataDir: config.runtimePaths.dataDir,
            fileInfo,
            localState,
            logger,
            signal,
            signalService,
            watermarkService: new PosterWatermarkService({ dataDir: config.runtimePaths.dataDir }),
          }),
        signalService,
        translateService: new TranslateService(networkClient, { logger: runtimeLogger, mappingStore }),
      },
      { mode: input.executionMode, scrapeSessionId: input.scrapeSessionId },
    );

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
