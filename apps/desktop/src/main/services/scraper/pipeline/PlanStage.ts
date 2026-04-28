import { throwIfAborted } from "../abort";
import type { OrganizePlan } from "../FileOrganizer";
import type { ScrapeContext } from "./ScrapeContext";
import type { FileScraperStageRuntime, ScrapeStage } from "./types";

export class PlanStage implements ScrapeStage {
  constructor(private readonly runtime: FileScraperStageRuntime) {}

  async execute(context: ScrapeContext, signal?: AbortSignal): Promise<void> {
    const configuration = context.requireConfiguration();
    const crawlerData = context.requireCrawlerData();

    let plan: OrganizePlan = {
      ...this.runtime.fileOrganizer.plan(context.fileInfo, crawlerData, configuration, context.existingNfoLocalState, {
        executionMode: context.mode,
      }),
      subtitleSidecars: context.subtitleSidecars,
    };

    plan = await this.runtime.fileOrganizer.ensureOutputReady(plan, context.fileInfo.filePath);
    throwIfAborted(signal);
    context.plan = plan;
  }
}
