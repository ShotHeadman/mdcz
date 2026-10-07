import type { Website } from "./enums";
import type { AssetRef, RootFileRef } from "./mediaRef";

export type FileId = string;
export type GroupId = string;

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

/** What reading the video file found; a value the file does not reveal stays unknown. */
export interface VideoMeta {
  durationSeconds?: number;
  width?: number;
  height?: number;
  bitrate?: number;
}

export interface CrawlerData {
  title: string;
  /** Original crawler title retained when a configured title repair changes `title`. */
  original_title?: string;
  /** Published translation of `title`; never produced by crawlers or the merge. */
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
  /** Published translation of `plot`; never produced by crawlers or the merge. */
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
  /**
   * The originating crawler site. Local NFO snapshots from external tools may
   * not retain this provenance; freshly aggregated crawler data always has it.
   */
  website?: Website;
}

export interface FileInfo {
  filePath: string;
  fileName: string;
  extension: string;
  number: string;
  isSubtitled: boolean;
  subtitleTag?: SubtitleTag;
  isUncensored?: boolean;
  /** Classification marker parsed from the filename; user/NFO choices remain authoritative. */
  filenameUncensoredChoice?: UncensoredChoice;
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
  rootId?: string;
  thumb?: string;
  poster?: string;
  fanart?: string;
  sceneImages: string[];
  trailer?: string;
  /** Flat list of every asset path created during the current scrape. */
  downloaded: string[];
}

export interface ScrapeResult {
  size?: number;
  resultId?: string;
  fileId: FileId;
  rootId: string;
  relativePath: string;
  fileName: string;
  status: ScrapeResultStatus;
  crawlerData?: CrawlerData;
  videoMeta?: VideoMeta;
  error?: string;
  output?: RootFileRef;
  nfo?: RootFileRef;
  assets: AssetRef[];
  /** Maps each CrawlerData field to the Website that provided the value. */
  sources?: Partial<Record<keyof CrawlerData, Website>>;
  /** Set when the file needs a person: a failure that the pending list explains, or an uncensored type to confirm. */
  pending?: ScrapePendingOutcome;
  part?: FileInfo["part"];
}

export interface ScrapePendingOutcome {
  kind: import("./pending").PendingKindDto;
  number?: string;
  candidates?: import("./pending").AmbiguousCandidate[];
}

export type UncensoredChoice = "umr" | "leak" | "uncensored";

/** NFO elements people edit by hand or in a media server, which MDCz fingerprints to recognize those edits. */
export type NfoEditableField =
  | "title"
  | "originaltitle"
  | "plot"
  | "actor"
  | "genre"
  | "studio"
  | "director"
  | "publisher"
  | "set"
  | "premiered"
  | "rating";

export interface NfoLocalState {
  uncensoredChoice?: UncensoredChoice;
  tags?: string[];
  /** `<lockedfields>` names set in Emby/Jellyfin; MDCz honors the ones it knows and writes them all back. */
  lockedFields?: string[];
  /** Fingerprints of the values MDCz last published in this NFO. */
  published?: Partial<Record<NfoEditableField, string>>;
  /** Fingerprints of the values someone changed since then; those values outrank site data. */
  edits?: Partial<Record<NfoEditableField, string>>;
  /** `<fileinfo>` as MDCz or the media server measured it; maintenance never reads the video, so it writes this back. */
  fileinfo?: Record<string, unknown>;
  /** The detail page someone chose for this movie; scrapes and refreshes use it instead of searching by number. */
  sourcePin?: { site: Website; url: string };
}

export interface UncensoredConfirmResultItem {
  fileId: FileId;
  sourceVideoPath: string;
  targetVideoPath: string;
  targetNfoPath?: string;
  choice: UncensoredChoice;
}

export interface UncensoredConfirmResponse {
  updatedCount: number;
  items: UncensoredConfirmResultItem[];
}

export type NamingPreviewSampleId = "standard" | "subtitled" | "multiActor" | "noActor";

export interface NamingPreviewItem {
  sample: NamingPreviewSampleId;
  /** Output folder relative to the target root; empty when files stay in place. */
  folder: string;
  file: string;
  sourcePath: string;
  mediaPath: string;
  metadataDir: string;
  outputs: string[];
}

export interface MediaCandidate {
  path: string;
  name: string;
  size: number;
  lastModified: string | null;
  extension: string;
  ref: RootFileRef;
}

export interface IpcError {
  code: string;
  message: string;
  fields?: string[];
  fieldErrors?: Record<string, string>;
}

// ── Maintenance Mode ──────────────────────────────────────────────

export type MaintenancePresetId = "import_local" | "refresh_metadata" | "remerge" | "local_organize" | "rebuild_all";
/** Assets discovered on disk for an existing video. */
export interface DiscoveredAssets {
  thumb?: string;
  poster?: string;
  fanart?: string;
  sceneImages: string[];
  trailer?: string;
  actorPhotos: string[];
}

/** A single video entry produced by local directory scanning. */
export interface LocalScanEntry {
  fileId: FileId;
  ref: RootFileRef;
  fileInfo: FileInfo;
  /** The NFO metadata is read from; always the first of `nfoPaths`. */
  nfoPath?: string;
  /** Every NFO sidecar belonging to the video, e.g. both `<movie>.nfo` and `movie.nfo`. */
  nfoPaths: string[];
  crawlerData?: CrawlerData;
  nfoLocalState?: NfoLocalState;
  scanError?: string;
  assets: DiscoveredAssets;
  currentDir: string;
  groupingDirectory?: string;
}

/** A single field-level difference between old and new CrawlerData. */
export interface FieldDiffImagePreview {
  src: string;
  fallbackSrcs: string[];
}

export interface FieldDiffImageCollectionPreview {
  items: string[];
}

/** Fields compared in maintenance previews; display labels live in the UI locale dictionaries. */
export type MaintenanceDiffField =
  | "title"
  | "title_zh"
  | "plot"
  | "plot_zh"
  | "studio"
  | "director"
  | "publisher"
  | "series"
  | "release_date"
  | "rating"
  | "durationSeconds"
  | "content_type"
  | "trailer_url"
  | "thumb_url"
  | "poster_url"
  | "actors"
  | "genres"
  | "scene_images";

interface BaseFieldDiff {
  field: MaintenanceDiffField;
  oldValue: unknown;
  newValue: unknown;
  changed: boolean;
  /** The old value is an edit made after MDCz published the NFO, so it is kept unless the user picks the new one. */
  userEdited?: boolean;
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
  fileId: FileId;
  currentVideoPath: string;
  targetVideoPath: string;
  currentDir: string;
  targetDir: string;
  changed: boolean;
}

export type MaintenancePreviewStatus = "pending" | "processing" | "ready" | "blocked";

export interface MaintenancePreviewItem {
  fileId: FileId;
  previewId?: string;
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
  thumb?: "preserve" | "replace";
  poster?: "preserve" | "replace";
  fanart?: "preserve" | "replace";
  sceneImages?: "preserve" | "replace";
  trailer?: "preserve" | "replace";
}

export type MaintenanceItemStatus = "pending" | "processing" | "success" | "failed" | "skipped";

/** Per-item execution result pushed via IPC events. */
export interface MaintenanceItemResult {
  fileId: FileId;
  batchId?: string;
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
  state: "idle" | "scanning" | "previewing" | "executing" | "paused" | "stopping";
  totalEntries: number | null;
  completedEntries: number;
  successCount: number;
  failedCount: number;
}
