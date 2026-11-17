import type { NormalizedCropRegion } from "./posterCrop";
import type { PosterCut } from "./types";

export type ConnectionCheckStatus = "ok" | "error" | "skipped";
export type ConnectionServerInfo = {
  serverName?: string;
  version?: string;
};

export type MediaServerCheckKey = "server" | "auth" | "peopleRead" | "peopleWrite" | "adminKey";

/** Why a step ended as it did, so the UI can explain it without backend prose. */
export type ConnectionCheckReason =
  | "service_unreachable"
  | "auth_rejected"
  | "auth_unverified"
  | "people_check_failed"
  | "empty_library";

export type MediaServerCheckStep = {
  key: MediaServerCheckKey;
  status: ConnectionCheckStatus;
  reason?: ConnectionCheckReason;
  /** Raw error text from the server or network layer. */
  detail?: string;
  code?: string;
};

export type MediaServerConnectionCheckResult = {
  success: boolean;
  steps: MediaServerCheckStep[];
  serverInfo?: ConnectionServerInfo;
  personCount?: number;
  /** Jellyfin only: whether it fills every new person from a TMDb or OMDb search by name. */
  matchesPeopleByName?: boolean;
};

export type PersonSyncResult = {
  processedCount: number;
  failedCount: number;
  skippedCount: number;
};

export type AmazonPosterScanItem = {
  /** The movie's video; the parts of a movie that share one NFO appear once. */
  filePath: string;
  nfoPath: string;
  title: string;
  number: string;
  currentPosterPath: string | null;
  currentPosterWidth: number;
  currentPosterHeight: number;
  /** How the current poster was cut, when MDCz cut it; the tool starts from it for the same image. */
  posterCut?: PosterCut;
};

export type AmazonPosterLookupReason =
  | "found"
  | "missing_title"
  | "search_failed"
  | "no_results"
  | "no_match"
  | "detail_unreadable"
  | "image_unreachable"
  | "query_failed";

export type AmazonPosterLookupResult = {
  nfoPath: string;
  amazonPosterUrl: string | null;
  reason: AmazonPosterLookupReason;
  /** Raw error text when reason is "query_failed". */
  error?: string;
  elapsedMs: number;
};

export type AmazonPosterApplyItem = {
  filePath: string;
  amazonPosterUrl: string;
  crop: NormalizedCropRegion;
};

export type AmazonPosterApplyResultItem = {
  filePath: string;
  success: boolean;
  error?: string;
};

export type BatchTranslateField = "title" | "plot";

/**
 * `all` translates the source text again even where a translation exists, e.g. after switching models; `restore`
 * drops translations so the NFO shows the source text it keeps alongside.
 */
export type BatchTranslateMode = "untranslated" | "all" | "restore";

export type BatchTranslateScanItem = {
  filePath: string;
  nfoPath: string;
  directory: string;
  number: string;
  title: string;
  pendingFields: BatchTranslateField[];
};

export type BatchTranslateApplyResultItem = {
  filePath: string;
  nfoPath: string;
  directory: string;
  number: string;
  success: boolean;
  translatedFields: BatchTranslateField[];
  error?: string;
};
