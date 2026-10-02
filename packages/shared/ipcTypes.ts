import type { TranslateTestInputDto } from "./serverDtos";

export type IpcActionContext = {
  // biome-ignore lint/suspicious/noExplicitAny: keep shared IPC contracts structurally compatible with tipc without importing desktop/Electron types.
  sender: any;
  senderFrame?: { url?: string } | null;
};

export interface IpcProcedure<TInput = unknown, TOutput = unknown> {
  action(options: { context: IpcActionContext; input: TInput }): Promise<TOutput>;
}

export type IpcProcedureInput<Procedure extends IpcProcedure> =
  Procedure extends IpcProcedure<infer Input, infer _Output> ? Input : never;

export type IpcProcedureOutput<Procedure extends IpcProcedure> =
  Procedure extends IpcProcedure<infer _Input, infer Output> ? Output : never;

export type AppInfo = {
  version: string;
  arch: string;
  platform: string;
  isPackaged: boolean;
};

/** `manualDownloadUrl` is null when the running build can download and install the update itself. */
export type AppUpdateStatus =
  | { phase: "idle" | "checking" | "latest" }
  | { phase: "available"; version: string; releaseUrl: string; manualDownloadUrl: string | null }
  | { phase: "downloading"; version: string; percent: number }
  | { phase: "downloaded"; version: string }
  | { phase: "error"; message: string };

export type WatermarkDirectoryInfo = {
  path: string;
};

export type TranslateTestInput = TranslateTestInputDto;

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
};

export type PersonSyncResult = {
  processedCount: number;
  failedCount: number;
  skippedCount: number;
};

export type AmazonPosterScanItem = {
  nfoPath: string;
  directory: string;
  title: string;
  searchTitle: string;
  number: string;
  currentPosterPath: string | null;
  currentPosterWidth: number;
  currentPosterHeight: number;
  currentPosterSize: number;
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

export type AmazonPosterApplyResultItem = {
  directory: string;
  success: boolean;
  savedPosterPath: string;
  replacedExisting: boolean;
  fileSize: number;
  error?: string;
};

export type BatchTranslateField = "title" | "plot";

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
  savedNfoPath?: string;
  error?: string;
};

export type BatchTranslateApplyInput = {
  items?: BatchTranslateScanItem[];
  batchSize?: number;
};
