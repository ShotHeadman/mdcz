import { IpcChannel } from "../IpcChannel";
import type { IpcProcedure } from "../ipcTypes";
import type { ScraperStatus, UncensoredConfirmItem, UncensoredConfirmResponse } from "../types";

export type ScraperIpcContract = {
  [IpcChannel.Scraper_Start]: IpcProcedure<
    { mode?: "single" | "batch"; paths?: string[] },
    { taskId: string; totalFiles: number; message: string }
  >;
  [IpcChannel.Scraper_Stop]: IpcProcedure<void, { success: true; pendingCount: number }>;
  [IpcChannel.Scraper_Pause]: IpcProcedure<void, { success: true }>;
  [IpcChannel.Scraper_Resume]: IpcProcedure<void, { success: true }>;
  [IpcChannel.Scraper_GetStatus]: IpcProcedure<void, ScraperStatus>;
  [IpcChannel.Scraper_GetFailedFiles]: IpcProcedure<void, { filePaths: string[] }>;
  [IpcChannel.Scraper_Requeue]: IpcProcedure<{ filePaths?: string[] }, { requeuedCount: number }>;
  [IpcChannel.Scraper_RetryFailed]: IpcProcedure<
    { filePaths?: string[] },
    { taskId: string; totalFiles: number; message: string }
  >;
  [IpcChannel.Scraper_GetRecoverableSession]: IpcProcedure<
    void,
    { recoverable: boolean; pendingCount: number; failedCount: number }
  >;
  [IpcChannel.Scraper_ResolveRecoverableSession]: IpcProcedure<
    { action?: "recover" | "discard" },
    { success: true; message: string; taskId?: string; totalFiles?: number }
  >;
  [IpcChannel.Scraper_ConfirmUncensored]: IpcProcedure<{ items?: UncensoredConfirmItem[] }, UncensoredConfirmResponse>;
};
