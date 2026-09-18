import type { MediaRoot } from "@mdcz/media-store";
import { resolveRootRelativePath } from "@mdcz/media-store";
import type { Configuration } from "@mdcz/shared/config";
import type { CrawlerData, FileInfo, NfoLocalState, ScrapeResult } from "@mdcz/shared/types";
import type { RuntimeDownloadNetworkClient } from "../network";
import type { PublicationOutputPort } from "../publication/types";
import type { ActorImageService } from "./ActorImageService";
import type { RuntimeActorSourceProvider } from "./actorOutput";
import type { AggregationResult, ManualScrapeOptions } from "./aggregation";
import { DirectoryInventory } from "./DirectoryInventory";
import { DownloadManager, type ImageHostCooldownStore } from "./download";
import { FileOrganizer, type ScrapeExecutionMode } from "./FileOrganizer";
import {
  FileScraper,
  type PreparedFileScrape,
  type RuntimeScrapeSignalService,
  type ScrapeGroupResult,
} from "./FileScraper";
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
  configuration: Configuration;
  root: MediaRoot;
  outputRoot?: MediaRoot;
  outputRelativeDirectory?: string;
  relativePath: string;
  scrapeSessionId?: string;
  manualScrape?: ManualScrapeOptions;
  localState?: NfoLocalState;
  operationId?: string;
  outputDirectory?: string;
  outputTemplateRoot?: string;
  publicationRoots?: MediaRoot[];
  onEvent?: (type: string, message: string) => Promise<void> | void;
  onProgress?: (percent: number) => Promise<void> | void;
  onStage?: (stage: "search" | "download" | "parse" | "organize", message: string) => Promise<void> | void;
  signal?: AbortSignal;
}

export interface MountedRootScrapeRuntimeItemFailure {
  status: "failed" | "skipped";
  result: ScrapeResult;
  error: string;
}

export interface PreparedMountedRootScrape {
  fileScrape: PreparedFileScrape;
  signalService: MountedRootScrapeSignalService;
}

export type MountedRootScrapePreparationResult =
  | { status: "prepared"; prepared: PreparedMountedRootScrape }
  | MountedRootScrapeRuntimeItemFailure;

class MountedRootScrapeSignalService implements RuntimeScrapeSignalService {
  private readonly pending = new Set<Promise<void>>();
  private readonly errors: unknown[] = [];

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

  setProgress(value: number): void {
    this.track(this.input.onProgress?.(value));
  }

  async flush(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
    const errors = this.errors.splice(0);
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Scrape reporting failed");
  }

  private track(result: Promise<void> | void): void {
    if (!result) return;
    const tracked = result
      .catch((error) => {
        this.errors.push(error);
      })
      .finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
  }
}

export interface MountedRootScrapeRuntimeDependencies {
  outputs?: PublicationOutputPort;
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
  private readonly scraper: FileScraper;

  constructor(
    private readonly deps: MountedRootScrapeRuntimeDependencies,
    executionMode: ScrapeExecutionMode = "batch",
    inventory?: DirectoryInventory,
  ) {
    const signalService: RuntimeScrapeSignalService = {
      showFailedInfo: () => undefined,
      showLogText: (message) => console.info(message),
      showScrapeInfo: () => undefined,
      setProgress: () => undefined,
    };
    const { config, aggregationService, networkClient, mappingStore, imageHostCooldownStore, actorSourceProvider } =
      this.deps;
    const logger = this.deps.logger ?? console;
    const runtimeLogger = toRuntimeLogger(logger);
    const fileOrganizer = new FileOrganizer(runtimeLogger);
    const { actorImageService } = this.deps;
    const watermarkService = new PosterWatermarkService({ dataDir: config.runtimePaths.dataDir });
    this.scraper = new FileScraper(
      {
        outputs: this.deps.outputs,
        actorImageService,
        actorSourceProvider,
        aggregationService,
        downloadManager: new DownloadManager(networkClient, {
          imageHostCooldownStore,
          logger: runtimeLogger,
        }),
        fileOrganizer,
        getConfiguration: async () => {
          throw new Error("Mounted scrape requires explicit configuration");
        },
        logger,
        nfoGenerator: new NfoGenerator(),
        postProcessAssets: async ({
          assets,
          configuration,
          crawlerData,
          fileInfo,
          localState,
          signal,
          signalService,
        }) =>
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
            watermarkService,
          }),
        signalService,
        translateService: new TranslateService(networkClient, { logger: runtimeLogger, mappingStore }),
      },
      { mode: executionMode, inventory: inventory ?? new DirectoryInventory() },
    );
  }

  createExecution(
    executionMode: ScrapeExecutionMode,
    outputs?: PublicationOutputPort,
    inventory?: DirectoryInventory,
  ): MountedRootScrapeRuntime {
    return new MountedRootScrapeRuntime({ ...this.deps, outputs }, executionMode, inventory);
  }

  async prepareGroup(
    inputs: readonly MountedRootScrapeRuntimeItemInput[],
  ): Promise<MountedRootScrapePreparationResult[]> {
    const services = inputs.map((input) => new MountedRootScrapeSignalService(input));
    try {
      const results = await this.scraper.prepareGroup(
        inputs.map((input, index) => {
          const signalService = services[index];
          const roots = input.publicationRoots?.length
            ? input.publicationRoots
            : [input.root, input.outputRoot].filter((root): root is MediaRoot => Boolean(root));
          return {
            filePath: resolveRootRelativePath(input.root, input.relativePath),
            progress: {
              fileIndex: index + 1,
              totalFiles: inputs.length,
              onProgress: (value: number) => signalService.setProgress(value),
            },
            options: {
              configuration: input.configuration,
              localState: input.localState,
              signalService,
              manualScrape: input.manualScrape,
              scrapeSessionId: input.scrapeSessionId,
              source: { rootId: input.root.id, relativePath: input.relativePath },
              roots,
              operationId: input.operationId ?? `${input.scrapeSessionId ?? "scrape"}:${input.relativePath}`,
              outputDirectory: input.outputDirectory,
              outputTemplateRoot:
                input.outputTemplateRoot ??
                resolveRootRelativePath(input.outputRoot ?? input.root, input.outputRelativeDirectory ?? ""),
            },
          };
        }),
        inputs[0]?.signal,
      );
      return results.map((result, index) => {
        const signalService = services[index];
        if (result.status !== "prepared") {
          return {
            status: result.status === "skipped" ? "skipped" : "failed",
            result,
            error: result.error ?? "刮削失败",
          };
        }
        return { status: "prepared", prepared: { fileScrape: result.prepared, signalService } };
      });
    } finally {
      await Promise.all(services.map((service) => service.flush()));
    }
  }

  async executePrepared(
    entries: readonly (PreparedMountedRootScrape & { caseId?: string })[],
    signal?: AbortSignal,
  ): Promise<ScrapeGroupResult> {
    if (!entries.length) return { results: [] };
    let group: ScrapeGroupResult | undefined;
    let executionError: unknown;
    try {
      group = await this.scraper.executePreparedFiles(
        entries.map((entry) => ({
          prepared: entry.fileScrape,
          progress: {
            fileIndex: 1,
            totalFiles: entries.length,
            onProgress: (value) => entry.signalService.setProgress(value),
          },
          caseId: entry.caseId,
        })),
        signal,
      );
    } catch (error) {
      executionError = error;
    }
    const settled = await Promise.allSettled(entries.map((entry) => entry.signalService.flush()));
    const errors = settled.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
    if (errors.length) {
      if (executionError !== undefined) errors.unshift(executionError);
      try {
        await group?.release?.();
      } catch (cleanupError) {
        errors.push(cleanupError);
      }
      throw new AggregateError(errors, "Scrape execution reporting failed");
    }
    if (executionError !== undefined) throw executionError;
    if (!group) throw new Error("Scrape execution returned no group");
    return group;
  }
}
