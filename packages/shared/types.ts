import type { Website } from "./enums";

export interface ActorProfile {
  name: string;
  aliases?: string[];
  gender?: string;
  birth_date?: string;
  birth_place?: string;
  blood_type?: string;
  description?: string;
  photo_url?: string;
  height_cm?: number;
  bust_cm?: number;
  waist_cm?: number;
  hip_cm?: number;
  cup_size?: string;
}

export interface VideoMeta {
  durationSeconds: number;
  width: number;
  height: number;
  codec?: string;
  bitrate?: number;
}

export interface CrawlerData {
  title: string;
  title_zh?: string;
  number: string;
  actors: string[];
  // Prepared actor metadata for NFO/output flows; crawlers do not aggregate this field.
  actor_profiles?: ActorProfile[];
  genres: string[];
  content_type?: string;
  studio?: string;
  director?: string;
  publisher?: string;
  series?: string;
  plot?: string;
  plot_zh?: string;
  release_date?: string;
  durationSeconds?: number;
  rating?: number;
  thumb_url?: string;
  poster_url?: string;
  fanart_url?: string;
  thumb_source_url?: string;
  poster_source_url?: string;
  fanart_source_url?: string;
  trailer_source_url?: string;
  scene_images: string[];
  trailer_url?: string;
  website: Website;
}

export interface FileInfo {
  filePath: string;
  fileName: string;
  extension: string;
  number: string;
  isSubtitled: boolean;
  subtitleTag?: SubtitleTag;
  isUncensored?: boolean;
  resolution?: string;
  part?: {
    number: number;
    suffix: string;
  };
}

export type ScrapeResultStatus = "pending" | "processing" | "success" | "failed" | "skipped";
export type SubtitleTag = "字幕" | "中文字幕";

/** Structured record of all files produced by DownloadManager. */
export interface DownloadedAssets {
  thumb?: string;
  poster?: string;
  fanart?: string;
  sceneImages: string[];
  trailer?: string;
  /** Flat list of every asset path created during the current scrape. */
  downloaded: string[];
}

export interface ScrapeResult {
  fileInfo: FileInfo;
  status: ScrapeResultStatus;
  crawlerData?: CrawlerData;
  videoMeta?: VideoMeta;
  error?: string;
  outputPath?: string;
  nfoPath?: string;
  assets?: DownloadedAssets;
  /** Maps each CrawlerData field to the Website that provided the value. */
  sources?: Partial<Record<string, Website>>;
  /** True when the video is classified as uncensored but the specific type (破解/流出) is unknown. */
  uncensoredAmbiguous?: boolean;
}

export type UncensoredChoice = "umr" | "leak" | "uncensored";

export interface NfoLocalState {
  uncensoredChoice?: UncensoredChoice;
  tags?: string[];
}

export interface UncensoredConfirmItem {
  nfoPath: string;
  videoPath: string;
  choice: UncensoredChoice;
}

export interface UncensoredConfirmResultItem {
  sourceVideoPath: string;
  sourceNfoPath?: string;
  targetVideoPath: string;
  targetNfoPath?: string;
  choice: UncensoredChoice;
}

export interface UncensoredConfirmResponse {
  updatedCount: number;
  items: UncensoredConfirmResultItem[];
}

export interface NamingPreviewItem {
  label: string;
  folder: string;
  file: string;
}

export interface ScraperStatus {
  state: "idle" | "running" | "stopping" | "paused";
  running: boolean;
  totalFiles: number;
  completedFiles: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
}

export interface IpcError {
  code: string;
  message: string;
  fields?: string[];
  fieldErrors?: Record<string, string>;
}

// ── Maintenance Mode ──────────────────────────────────────────────

export type MaintenancePresetId = "read_local" | "refresh_data" | "organize_files" | "rebuild_all";

/** Assets discovered on disk for an existing video. */
export interface DiscoveredAssets {
  thumb?: string;
  poster?: string;
  fanart?: string;
  sceneImages: string[];
  trailer?: string;
  nfo?: string;
  actorPhotos: string[];
}

/** A single video entry produced by local directory scanning. */
export interface LocalScanEntry {
  id: string;
  videoPath: string;
  fileInfo: FileInfo;
  nfoPath?: string;
  crawlerData?: CrawlerData;
  nfoLocalState?: NfoLocalState;
  scanError?: string;
  assets: DiscoveredAssets;
  currentDir: string;
}

/** A single field-level difference between old and new CrawlerData. */
export interface FieldDiffImagePreview {
  src: string;
  fallbackSrcs: string[];
}

export interface FieldDiffImageCollectionPreview {
  items: string[];
}

interface BaseFieldDiff {
  field: keyof CrawlerData;
  label: string;
  oldValue: unknown;
  newValue: unknown;
  changed: boolean;
}

export interface ValueFieldDiff extends BaseFieldDiff {
  kind: "value";
}

export interface ImageFieldDiff extends BaseFieldDiff {
  kind: "image";
  oldPreview: FieldDiffImagePreview;
  newPreview: FieldDiffImagePreview;
}

export interface ImageCollectionFieldDiff extends BaseFieldDiff {
  kind: "imageCollection";
  oldPreview: FieldDiffImageCollectionPreview;
  newPreview: FieldDiffImageCollectionPreview;
}

export type FieldDiff = ValueFieldDiff | ImageFieldDiff | ImageCollectionFieldDiff;

/** Path migration plan for a single video. */
export interface PathDiff {
  entryId: string;
  currentVideoPath: string;
  targetVideoPath: string;
  currentDir: string;
  targetDir: string;
  changed: boolean;
}

export type MaintenancePreviewStatus = "ready" | "blocked";

export interface MaintenancePreviewItem {
  entryId: string;
  status: MaintenancePreviewStatus;
  error?: string;
  fieldDiffs?: FieldDiff[];
  unchangedFieldDiffs?: FieldDiff[];
  pathDiff?: PathDiff;
  proposedCrawlerData?: CrawlerData;
  imageAlternatives?: MaintenanceImageAlternatives;
}

export interface MaintenancePreviewResult {
  items: MaintenancePreviewItem[];
}

export interface MaintenanceImageAlternatives {
  thumb_url?: string[];
  poster_url?: string[];
  scene_images?: string[][];
}

export interface MaintenanceAssetDecisions {
  fanart?: "preserve" | "replace";
  sceneImages?: "preserve" | "replace";
  trailer?: "preserve" | "replace";
}

export interface MaintenanceCommitItem {
  entry: LocalScanEntry;
  crawlerData?: CrawlerData;
  imageAlternatives?: MaintenanceImageAlternatives;
  assetDecisions?: MaintenanceAssetDecisions;
}

export type MaintenanceItemStatus = "pending" | "processing" | "success" | "failed";

/** Per-item execution result pushed via IPC events. */
export interface MaintenanceItemResult {
  entryId: string;
  status: MaintenanceItemStatus;
  error?: string;
  crawlerData?: CrawlerData;
  updatedEntry?: LocalScanEntry;
  fieldDiffs?: FieldDiff[];
  unchangedFieldDiffs?: FieldDiff[];
  pathDiff?: PathDiff;
}

/** Overall maintenance execution status. */
export interface MaintenanceStatus {
  state: "idle" | "scanning" | "executing" | "stopping";
  totalEntries: number;
  completedEntries: number;
  successCount: number;
  failedCount: number;
}
