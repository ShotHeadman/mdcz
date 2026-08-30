import { IpcChannel } from "../IpcChannel";
import type { IpcProcedure } from "../ipcTypes";
import type { RootFileRef } from "../mediaRef";
import type { ScrapeRunSnapshotDto } from "../serverDtos";
import type { UncensoredConfirmItem, UncensoredConfirmResponse } from "../types";

export type ScraperStartInput =
  | { mode: "selection"; refs: RootFileRef[]; outputRootId?: string }
  | { mode: "single"; ref: RootFileRef };

export type ScraperIpcContract = {
  [IpcChannel.Scraper_Start]: IpcProcedure<ScraperStartInput, { taskId: string; totalFiles: number; message: string }>;
  [IpcChannel.Scraper_StartSinglePath]: IpcProcedure<
    { path: string },
    { taskId: string; totalFiles: number; message: string }
  >;
  [IpcChannel.Scraper_Stop]: IpcProcedure<void, { success: true; pendingCount: number }>;
  [IpcChannel.Scraper_Pause]: IpcProcedure<void, { success: true }>;
  [IpcChannel.Scraper_Resume]: IpcProcedure<void, { success: true }>;
  [IpcChannel.Scraper_GetStatus]: IpcProcedure<void, ScrapeRunSnapshotDto | null>;
  [IpcChannel.Scraper_Retry]: IpcProcedure<{ runId: string }, { taskId: string; totalFiles: number; message: string }>;
  [IpcChannel.Scraper_ConfirmUncensored]: IpcProcedure<{ items?: UncensoredConfirmItem[] }, UncensoredConfirmResponse>;
};
