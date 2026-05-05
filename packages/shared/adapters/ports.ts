import type { DetailViewItem } from "@mdcz/views/detail";
import type { MaintenanceFieldSelectionSide } from "../maintenanceCommit";
import type { ScrapeFileRefDto } from "../serverDtos";
import type {
  CrawlerData,
  LocalScanEntry,
  MaintenanceCommitItem,
  MaintenancePresetId,
  MaintenancePreviewItem,
} from "../types";

export type ActionAvailability = "enabled" | "disabled" | "hidden";

export interface NativeActionCapabilities {
  play?: ActionAvailability;
  openFolder?: ActionAvailability;
  openNfo?: ActionAvailability;
  deleteFile?: ActionAvailability;
  deleteFileAndFolder?: ActionAvailability;
}

export interface DetailNfoReadResponse {
  path: string;
  crawlerData: CrawlerData | null;
}

export interface DetailActionPort {
  capabilities?: Pick<NativeActionCapabilities, "play" | "openFolder" | "openNfo">;
  play(item: DetailViewItem): Promise<void> | void;
  openFolder(item: DetailViewItem): Promise<void> | void;
  readNfo(item: DetailViewItem, path: string): Promise<DetailNfoReadResponse>;
  writeNfo(item: DetailViewItem, path: string, data: CrawlerData): Promise<void>;
}

export interface ScrapeActionPort {
  capabilities?: NativeActionCapabilities;
  retrySelection(
    targets: Array<{ filePath: string; ref?: ScrapeFileRefDto }>,
    options: {
      scrapeStatus: "idle" | "running" | "stopping" | "paused";
      canRequeueCurrentRun?: boolean;
      manualUrl?: string;
    },
  ): Promise<{ message: string; strategy?: "new-task" | string }>;
  deleteFile(filePaths: string[]): Promise<void>;
  deleteFileAndFolder(filePath: string): Promise<void>;
  openFolder(filePath: string): Promise<void> | void;
  play(filePath: string): Promise<void> | void;
  openNfo(path: string): Promise<void> | void;
}

export interface MaintenanceActionPort {
  capabilities?: Pick<NativeActionCapabilities, "play" | "openFolder" | "openNfo">;
  openFolder(filePath: string): Promise<void> | void;
  play(filePath: string): Promise<void> | void;
  openNfo(path: string): Promise<void> | void;
  scanFiles(filePaths: string[], context?: { scanDir?: string }): Promise<{ entries: LocalScanEntry[] }>;
  preview(entries: LocalScanEntry[], presetId: MaintenancePresetId): Promise<{ items: MaintenancePreviewItem[] }>;
  execute(
    commitItems: MaintenanceCommitItem[],
    presetId: MaintenancePresetId,
    context?: {
      previewResults: Record<string, MaintenancePreviewItem>;
      fieldSelections: Record<string, Record<string, MaintenanceFieldSelectionSide>>;
    },
  ): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
}

export interface SharedWorkbenchPorts {
  detail: DetailActionPort;
  scrape: ScrapeActionPort;
  maintenance: MaintenanceActionPort;
}
