import type {
  MaintenanceActiveSessionSnapshot,
  MaintenanceApplySelection,
  MaintenanceFieldSelectionSide,
} from "@mdcz/shared/maintenanceTasks";
import type { NormalizedCropRegion } from "@mdcz/shared/posterCrop";
import type { ScrapeFileRefDto } from "@mdcz/shared/serverDtos";
import type { CrawlerData, LocalScanEntry, MaintenancePresetId } from "@mdcz/shared/types";
import type { DetailViewItem } from "../detail";

export type ActionAvailability = "enabled" | "disabled" | "hidden";

export interface NativeActionCapabilities {
  play?: ActionAvailability;
  openFolder?: ActionAvailability;
  openNfo?: ActionAvailability;
  editPoster?: ActionAvailability;
  deleteFile?: ActionAvailability;
  deleteFileAndFolder?: ActionAvailability;
}

export interface DetailNfoReadResponse {
  path: string;
  crawlerData: CrawlerData | null;
}

export interface DetailActionPort {
  capabilities?: Pick<NativeActionCapabilities, "play" | "openFolder" | "openNfo" | "editPoster">;
  showFilePath: boolean;
  resolveImageCandidates(candidates: string[], baseDir?: string, item?: DetailViewItem | null): Promise<string[]>;
  play(item: DetailViewItem): Promise<void> | void;
  openFolder(item: DetailViewItem): Promise<void> | void;
  readNfo(item: DetailViewItem, path: string): Promise<DetailNfoReadResponse>;
  writeNfo(item: DetailViewItem, path: string, data: CrawlerData): Promise<void>;
  preparePosterCrop(item: DetailViewItem): Promise<PosterCropEditSession>;
  savePosterCrop(item: DetailViewItem, crop: NormalizedCropRegion): Promise<{ posterUrl: string }>;
}

export interface PosterCropEditSession {
  sourceUrl: string;
  width: number;
  height: number;
  initialCrop: NormalizedCropRegion;
}

export interface ScrapeActionPort {
  capabilities?: NativeActionCapabilities;
  getDeleteFileAvailability?(targets: Array<{ filePath: string; ref?: ScrapeFileRefDto }>): ActionAvailability;
  retrySelection(
    targets: Array<{ filePath: string; ref?: ScrapeFileRefDto }>,
    options: {
      scrapeStatus: "idle" | "running" | "stopping" | "paused";
      manualUrl?: string;
    },
  ): Promise<{ message: string }>;
  deleteFile(targets: Array<{ filePath: string; ref?: ScrapeFileRefDto }>): Promise<void>;
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
  getActiveSession(): Promise<MaintenanceActiveSessionSnapshot | null>;
  updateDraft(
    previewId: string,
    draft: {
      fieldSelections?: Record<string, MaintenanceFieldSelectionSide>;
    },
  ): Promise<void>;
  discardSession(): Promise<void>;
  preview(entries: LocalScanEntry[], presetId: MaintenancePresetId): Promise<{ sessionId: string }>;
  execute(selections: MaintenanceApplySelection[], presetId: MaintenancePresetId): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
}

export interface SharedWorkbenchPorts {
  detail: DetailActionPort;
  scrape: ScrapeActionPort;
  maintenance: MaintenanceActionPort;
}
