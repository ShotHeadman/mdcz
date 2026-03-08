import type { ActionContext } from "@egoist/tipc/main";

export type IpcProcedure<TInput = unknown, TOutput = unknown> = {
  action: (options: { context: ActionContext; input: TInput }) => Promise<TOutput>;
};

export type AppInfo = {
  version: string;
  arch: string;
  platform: string;
  isPackaged: boolean;
};

export type TranslateTestLlmInput = {
  llmModelName?: string;
  llmApiKey?: string;
  llmBaseUrl?: string;
  llmTemperature?: number;
};

export type JellyfinCheckKey = "server" | "auth" | "peopleRead" | "peopleWrite";
export type JellyfinCheckStatus = "ok" | "error" | "skipped";

export type JellyfinCheckStep = {
  key: JellyfinCheckKey;
  label: string;
  status: JellyfinCheckStatus;
  message: string;
  code?: string;
};

export type JellyfinConnectionCheckResult = {
  success: boolean;
  steps: JellyfinCheckStep[];
  serverInfo?: {
    serverName?: string;
    version?: string;
  };
  personCount?: number;
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
