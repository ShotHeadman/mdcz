import { canonicalizeCrawlerDataActorAliases } from "../canonicalizeActorAliases";
import { throwIfAborted } from "../utils/abort";
import type { ScrapeContext } from "./ScrapeContext";
import type { ScrapeStage } from "./types";

export class CanonicalizeActorAliasesStage implements ScrapeStage {
  async execute(context: ScrapeContext, signal?: AbortSignal): Promise<void> {
    context.translatedCrawlerData = canonicalizeCrawlerDataActorAliases(
      context.requireCrawlerData(),
      context.requireConfiguration(),
    );
    throwIfAborted(signal);
  }
}
