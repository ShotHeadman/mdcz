import { throwIfAborted } from "../utils/abort";
import type { ScrapeContext } from "./ScrapeContext";
import type { FileScraperStageRuntime, ScrapeStage } from "./types";

export class NfoStage implements ScrapeStage {
  constructor(private readonly runtime: FileScraperStageRuntime) {}

  async execute(context: ScrapeContext, signal?: AbortSignal): Promise<void> {
    if (context.requireConfiguration().download.generateNfo && context.plan) {
      this.runtime.signalService.showLogText(`[${context.fileInfo.number}] Generating NFO...`);
    }
    context.savedNfoPath = await this.runtime.writePreparedNfo(context, signal);

    throwIfAborted(signal);
    this.runtime.setProgress(context.progress, 80);
  }
}
