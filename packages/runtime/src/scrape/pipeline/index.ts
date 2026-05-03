import type { ScrapeResult } from "@mdcz/shared/types";
import type { ManualScrapeOptions } from "../aggregation";
import type { ScrapeContext } from "./ScrapeContext";
import type { ScrapeStage } from "./types";

export { AggregateStage } from "./AggregateStage";
export { AggregationCoordinator } from "./AggregationCoordinator";
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

export interface FileScraperPipeline {
  readonly stages: readonly ScrapeStage[];

  createContext(
    filePath: string,
    progress?: { fileIndex: number; totalFiles: number },
    options?: { manualScrape?: ManualScrapeOptions },
  ): ScrapeContext;

  setProgress(progress: { fileIndex: number; totalFiles: number }, stepPercent: number): void;

  runExclusiveByNumber<T>(number: string, operation: () => Promise<T>): Promise<T>;

  handleAbort(context: ScrapeContext): Promise<ScrapeResult>;

  handleError(context: ScrapeContext, error: unknown): Promise<ScrapeResult>;
}
