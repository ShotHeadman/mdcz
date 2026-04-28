export type IpcActionContext = {
  // biome-ignore lint/suspicious/noExplicitAny: keep shared IPC contracts structurally compatible with tipc without importing desktop/Electron types.
  sender: any;
};

export interface IpcProcedure<TInput = unknown, TOutput = unknown> {
  action(options: { context: IpcActionContext; input: TInput }): Promise<TOutput>;
}

export type AppInfo = {
  version: string;
  arch: string;
  platform: string;
  isPackaged: boolean;
};

export type WatermarkDirectoryInfo = {
  path: string;
};

export type TranslateTestLlmInput = {
  llmModelName?: string;
  llmApiKey?: string;
  llmBaseUrl?: string;
  llmPrompt?: string;
  llmTemperature?: number;
};

export type ConnectionCheckStatus = "ok" | "error" | "skipped";
export type ConnectionServerInfo = {
  serverName?: string;
  version?: string;
};

export type JellyfinCheckKey = "server" | "auth" | "peopleRead" | "peopleWrite";
export type EmbyCheckKey = "server" | "auth" | "peopleRead" | "peopleWrite" | "adminKey";

export type JellyfinCheckStep = {
  key: JellyfinCheckKey;
  label: string;
  status: ConnectionCheckStatus;
  message: string;
  code?: string;
};

export type JellyfinConnectionCheckResult = {
  success: boolean;
  steps: JellyfinCheckStep[];
  serverInfo?: ConnectionServerInfo;
  personCount?: number;
};

export type EmbyCheckStep = {
  key: EmbyCheckKey;
  label: string;
  status: ConnectionCheckStatus;
  message: string;
  code?: string;
};

export type EmbyConnectionCheckResult = {
  success: boolean;
  steps: EmbyCheckStep[];
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
  number: string;
  currentPosterPath: string | null;
  currentPosterWidth: number;
  currentPosterHeight: number;
  currentPosterSize: number;
};

export type AmazonPosterLookupResult = {
  nfoPath: string;
  amazonPosterUrl: string | null;
  reason: string;
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
