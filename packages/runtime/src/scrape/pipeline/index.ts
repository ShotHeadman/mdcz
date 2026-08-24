import type { ScrapeResult } from "@mdcz/shared/types";
import type { ManualScrapeOptions } from "../aggregation";
import { AggregateStage } from "./AggregateStage";
import { CanonicalizeActorAliasesStage } from "./CanonicalizeActorAliasesStage";
import { DownloadStage } from "./DownloadStage";
import { NfoStage } from "./NfoStage";
import { OrganizeStage } from "./OrganizeStage";
import { ParseStage } from "./ParseStage";
import { PlanStage } from "./PlanStage";
import { PrepareOutputStage } from "./PrepareOutputStage";
import { ProbeStage } from "./ProbeStage";
import type { ScrapeContext } from "./ScrapeContext";
import { TranslateStage } from "./TranslateStage";
import type { FileScraperStageRuntime, ScrapeStage } from "./types";

export { AggregateStage } from "./AggregateStage";
export { AggregationCoordinator } from "./AggregationCoordinator";
export { CanonicalizeActorAliasesStage } from "./CanonicalizeActorAliasesStage";
export { DownloadStage } from "./DownloadStage";
export { NfoStage } from "./NfoStage";
export { NumberExecutionGate } from "./NumberExecutionGate";
export { OrganizeStage } from "./OrganizeStage";
export { ParseStage } from "./ParseStage";
export { PlanStage } from "./PlanStage";
export { PrepareOutputStage } from "./PrepareOutputStage";
export { ProbeStage } from "./ProbeStage";
export { ScrapeContext } from "./ScrapeContext";
export { TranslateStage } from "./TranslateStage";
export type { FileScraperStageRuntime, RuntimeScrapeSignalService, ScrapeStage } from "./types";

export const createDefaultScrapeStages = (runtime: FileScraperStageRuntime): readonly ScrapeStage[] => [
  new ParseStage(),
  new ProbeStage(runtime),
  new AggregateStage(runtime),
  new TranslateStage(runtime),
  new CanonicalizeActorAliasesStage(),
  new PlanStage(runtime),
  new PrepareOutputStage(runtime),
  new DownloadStage(runtime),
  new NfoStage(runtime),
  new OrganizeStage(runtime),
];

export interface FileScraperPipeline {
  readonly stages: readonly ScrapeStage[];

  createContext(
    filePath: string,
    progress?: { fileIndex: number; totalFiles: number },
    options?: { manualScrape?: ManualScrapeOptions; scrapeSessionId?: string },
  ): Promise<ScrapeContext>;

  setProgress(progress: { fileIndex: number; totalFiles: number }, stepPercent: number): void;
  notifyProcessing?(context: ScrapeContext): void;

  runExclusiveByNumber<T>(number: string, operation: () => Promise<T>): Promise<T>;

  handleAbort(context: ScrapeContext): Promise<ScrapeResult>;

  handleError(context: ScrapeContext, error: unknown): Promise<ScrapeResult>;
}
