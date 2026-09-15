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

export interface DetailActionPort {
  showFilePath: boolean;
  resolveImageCandidates(candidates: string[], baseDir?: string, item?: DetailViewItem | null): Promise<string[]>;
  play?(item: DetailViewItem): Promise<void> | void;
  openFolder?(item: DetailViewItem): Promise<void> | void;
  openMetadataFolder?(item: DetailViewItem): Promise<void> | void;
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

export const resolveBatchRescrapeOutput = (
  targets: readonly ScrapeActionTarget[],
): { outputRootId: string; outputRelativeDirectory: string } => {
  const first = targets[0]?.ref;
  if (!first) throw new Error("请选择要刮削的文件");
  const slash = first.relativePath.lastIndexOf("/");
  const outputRelativeDirectory = slash < 0 ? "" : first.relativePath.slice(0, slash);
  if (
    targets.some((target) => {
      const targetSlash = target.ref.relativePath.lastIndexOf("/");
      const targetDirectory = targetSlash < 0 ? "" : target.ref.relativePath.slice(0, targetSlash);
      return target.ref.rootId !== first.rootId || targetDirectory !== outputRelativeDirectory;
    })
  ) {
    throw new Error("多文件按 URL 刮削仅支持同一媒体根目录下的同一目录");
  }
  return { outputRootId: first.rootId, outputRelativeDirectory };
};

export interface ScrapeActionPort {
  rerunDirectory(runId: string): Promise<void>;
  rescrapeByUrl(targets: ScrapeActionTarget[], manualUrl: string): Promise<{ message: string }>;
  retryFailed(itemIds?: readonly string[]): Promise<{ message: string }>;
  removeRecord?(targets: ScrapeActionTarget[]): Promise<void>;
  openFolder?(target: ScrapeActionTarget): Promise<void> | void;
  play?(target: ScrapeActionTarget): Promise<void> | void;
  openNfo(path: string): Promise<void> | void;
}

export interface MaintenanceActionPort {
  rerunDirectory?(sessionId: string): Promise<void>;
  openFolder?(filePath: string): Promise<void> | void;
  play?(filePath: string): Promise<void> | void;
  openNfo(path: string): Promise<void> | void;
  getActiveSession(): Promise<MaintenanceActiveSessionSnapshot | null>;
  updateDraft(
    previewId: string,
    draft: {
      fieldSelections?: Record<string, MaintenanceFieldSelectionSide>;
    },
  ): Promise<void>;
  discardSession(): Promise<void>;
  preview(refs: RootFileRef[], presetId: MaintenancePresetId, targetDir?: string): Promise<{ sessionId: string }>;
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
