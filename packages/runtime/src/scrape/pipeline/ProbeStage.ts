import type { ScrapeContext } from "./ScrapeContext";
import type { FileScraperStageRuntime, ScrapeStage } from "./types";

export class ProbeStage implements ScrapeStage {
  constructor(private readonly runtime: FileScraperStageRuntime) {}

  async execute(context: ScrapeContext): Promise<void> {
    context.videoMeta = await this.runtime.probeVideoMetadata(context);

    this.runtime.setProgress(context.progress, 30);
  }
}
