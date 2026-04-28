import { parse } from "node:path";
import { throwIfAborted } from "../abort";
import { applyResolvedSceneImageMetadata, downloadCrawlerAssets } from "../output";
import type { ScrapeContext } from "./ScrapeContext";
import type { FileScraperStageRuntime, ScrapeStage } from "./types";

export class DownloadStage implements ScrapeStage {
  constructor(private readonly runtime: FileScraperStageRuntime) {}

  async execute(context: ScrapeContext, signal?: AbortSignal): Promise<void> {
    const configuration = context.requireConfiguration();
    const aggregationResult = context.requireAggregationResult();
    const crawlerData = context.requireCrawlerData();
    const plan = context.requirePlan();

    this.runtime.signalService.showScrapeInfo({
      fileInfo: context.fileInfo,
      site: crawlerData.website,
      step: "download",
    });

    let resolvedSceneImageUrls: string[] | undefined;
    context.assets = await downloadCrawlerAssets({
      config: configuration,
      crawlerData,
      downloadManager: this.runtime.downloadManager,
      fileInfo: context.fileInfo,
      imageAlternatives: aggregationResult.imageAlternatives,
      localState: context.existingNfoLocalState,
      logger: this.runtime.logger,
      movieBaseName: parse(plan.nfoPath).name,
      outputDir: plan.outputDir,
      signalService: this.runtime.signalService,
      sources: aggregationResult.sources,
      callbacks: {
        onResolvedSceneImageUrls: (urls) => {
          resolvedSceneImageUrls = urls;
        },
        signal,
      },
    });

    throwIfAborted(signal);
    context.preparedCrawlerData = applyResolvedSceneImageMetadata(crawlerData, resolvedSceneImageUrls);
    this.runtime.setProgress(context.progress, 75);
  }
}
