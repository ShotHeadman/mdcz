import { classifyMovie, isLikelyUncensoredNumber } from "@main/utils/movieClassification";
import type { ScrapeResult } from "@shared/types";
import { throwIfAborted } from "../abort";
import { organizePreparedVideo } from "../output";
import type { ScrapeContext } from "./ScrapeContext";
import type { FileScraperStageRuntime, ScrapeStage } from "./types";

export class OrganizeStage implements ScrapeStage {
  constructor(private readonly runtime: FileScraperStageRuntime) {}

  async execute(context: ScrapeContext, signal?: AbortSignal): Promise<void> {
    const configuration = context.requireConfiguration();
    const aggregationResult = context.requireAggregationResult();
    const crawlerData = context.requireCrawlerData();
    const plan = context.requirePlan();

    this.runtime.signalService.showScrapeInfo({
      fileInfo: context.fileInfo,
      site: crawlerData.website,
      step: "organize",
    });

    throwIfAborted(signal);
    context.outputVideoPath = await organizePreparedVideo({
      config: configuration,
      enabled: true,
      fileInfo: context.fileInfo,
      fileOrganizer: this.runtime.fileOrganizer,
      plan,
    });

    this.runtime.setProgress(context.progress, 100);

    const classification = classifyMovie(context.fileInfo, crawlerData, context.existingNfoLocalState);
    const uncensoredAmbiguous =
      classification.uncensored &&
      !classification.umr &&
      !classification.leak &&
      !isLikelyUncensoredNumber(crawlerData.number || context.fileInfo.number);

    const result: ScrapeResult = {
      fileId: context.fileId,
      fileInfo: {
        ...context.fileInfo,
        filePath: context.outputVideoPath,
      },
      status: "success",
      crawlerData,
      videoMeta: context.videoMeta,
      outputPath: plan.outputDir,
      nfoPath: context.savedNfoPath,
      assets: context.assets,
      sources: aggregationResult.sources,
      uncensoredAmbiguous,
    };

    this.runtime.signalService.showScrapeResult(result);
    context.result = result;
  }
}
