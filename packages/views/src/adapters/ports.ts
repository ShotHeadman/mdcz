import type {
  MaintenanceActiveSessionSnapshot,
  MaintenanceApplySelection,
  MaintenanceFieldSelectionSide,
} from "@mdcz/shared/maintenanceTasks";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { NormalizedCropRegion } from "@mdcz/shared/posterCrop";
import type { ScrapeFileRefDto } from "@mdcz/shared/serverDtos";
import type { CrawlerData, MaintenancePresetId } from "@mdcz/shared/types";
import type { DetailViewItem } from "../detail";

export interface DetailNfoReadResponse {
  path: string;
  crawlerData: CrawlerData | null;
}

/** Desktop only: hands a file to the system's player or file manager. */
export interface FileActions {
  play(file: RootFileRef): Promise<void>;
  openFolder(file: RootFileRef): Promise<void>;
}

export interface DetailActionPort extends Partial<FileActions> {
  showFilePath: boolean;
  resolveImageCandidates(candidates: string[], baseDir?: string, item?: DetailViewItem | null): Promise<string[]>;
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

export interface ScrapeActionTarget {
  filePath: string;
  ref: ScrapeFileRefDto;
}

export interface ScrapeActionPort extends Partial<FileActions> {
  rerunDirectory(runId: string): Promise<void>;
  cancelActorSync(runId: string): Promise<void>;
  /** Re-scrapes from one detail page (pinning it), or by number with `unpin` (dropping a pinned page). */
  rescrape(targets: ScrapeActionTarget[], source: { manualUrl: string } | { unpin: true }): Promise<void>;
  retryFailed(itemIds?: readonly string[]): Promise<void>;
  removeRecord?(targets: ScrapeActionTarget[]): Promise<void>;
  openNfo(path: string): Promise<void> | void;
}

export interface MaintenanceActionPort extends Partial<FileActions> {
  rerunDirectory?(sessionId: string): Promise<void>;
  openNfo(path: string): Promise<void> | void;
  getActiveSession(): Promise<MaintenanceActiveSessionSnapshot | null>;
  updateDraft(
    previewId: string,
    draft: {
      fieldSelections?: Record<string, MaintenanceFieldSelectionSide>;
    },
  ): Promise<void>;
  discardSession(): Promise<void>;
  preview(refs: RootFileRef[], presetId: MaintenancePresetId, libraryId?: string): Promise<{ sessionId: string }>;
  execute(selections: MaintenanceApplySelection[]): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
}

export interface SharedWorkbenchPorts {
  detail: DetailActionPort;
  scrape: ScrapeActionPort;
  maintenance: MaintenanceActionPort;
}
