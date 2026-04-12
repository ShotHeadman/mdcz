import { probeVideoMetadataOrWarn } from "../output";
import type { ScrapeContext } from "./ScrapeContext";
import type { FileScraperStageRuntime, ScrapeStage } from "./types";

export class ProbeStage implements ScrapeStage {
  constructor(private readonly runtime: FileScraperStageRuntime) {}

  async execute(context: ScrapeContext): Promise<void> {
    context.videoMeta = await probeVideoMetadataOrWarn({
      logger: this.runtime.logger,
      sourceVideoPath: context.fileInfo.filePath,
      warningPrefix: "Video probe failed",
    });

    this.runtime.setProgress(context.progress, 30);
  }
}
