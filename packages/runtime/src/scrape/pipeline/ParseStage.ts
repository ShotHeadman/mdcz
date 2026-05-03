import type { ScrapeContext } from "./ScrapeContext";
import type { ScrapeStage } from "./types";

export class ParseStage implements ScrapeStage {
  async execute(context: ScrapeContext): Promise<void> {
    await context.resolveFileInfo();
  }
}
