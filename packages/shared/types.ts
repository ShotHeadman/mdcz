import type { Website } from "./enums";

export interface ActorProfile {
  name: string;
  aliases?: string[];
  gender?: string;
  birth_date?: string;
  description?: string;
  cover_url?: string;
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
  release_year?: number;
  durationSeconds?: number;
  rating?: number;
  cover_url?: string;
  poster_url?: string;
  fanart_url?: string;
  sample_images: string[];
  trailer_url?: string;
  website: Website;
}

export interface FileInfo {
  filePath: string;
  fileName: string;
  extension: string;
  number: string;
  isSubtitled: boolean;
  resolution?: string;
  partNumber?: number;
}

export type ScrapeResultStatus = "pending" | "processing" | "success" | "failed" | "skipped";

/** Structured record of all files produced by DownloadManager. */
export interface DownloadedAssets {
  cover?: string;
  poster?: string;
  fanart?: string;
  sceneImages: string[];
  trailer?: string;
  /** Flat list of every successfully downloaded path. */
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
