import type { DirectorySource } from "../directoryTasks";
import { IpcChannel } from "../IpcChannel";
import type { IpcProcedure } from "../ipcTypes";
import type { RootFileRef } from "../mediaRef";
import type { ScrapeConfirmUncensoredInput, ScrapeRunSnapshotDto } from "../serverDtos";
import type { UncensoredConfirmResponse } from "../types";

export type ScraperStartInput =
  | { mode: "directory"; source: DirectorySource; targetDir: string }
  | {
      mode: "selection";
      refs: RootFileRef[];
      outputRootId: string;
      outputRelativeDirectory?: string;
      manualUrl?: string;
    }
  | { mode: "single"; ref: RootFileRef; manualUrl?: string };

export type ScraperIpcContract = {
  [IpcChannel.Scraper_Start]: IpcProcedure<
    ScraperStartInput,
    { taskId: string; totalFiles: number | null; message: string; snapshot: ScrapeRunSnapshotDto }
  >;
  [IpcChannel.Scraper_StartSinglePath]: IpcProcedure<
    { path: string },
    { taskId: string; totalFiles: number | null; message: string; snapshot: ScrapeRunSnapshotDto }
  >;
  [IpcChannel.Scraper_Stop]: IpcProcedure<void, { success: true; pendingCount: number }>;
  [IpcChannel.Scraper_Pause]: IpcProcedure<void, { success: true }>;
  [IpcChannel.Scraper_Resume]: IpcProcedure<void, { success: true }>;
  [IpcChannel.Scraper_GetStatus]: IpcProcedure<{ taskId?: string }, ScrapeRunSnapshotDto | null>;
  [IpcChannel.Scraper_RerunDirectory]: IpcProcedure<
    { runId: string },
    { taskId: string; totalFiles: number | null; message: string; snapshot: ScrapeRunSnapshotDto }
  >;
  [IpcChannel.Scraper_Retry]: IpcProcedure<
    { runId: string; itemIds?: string[] },
    { taskId: string; totalFiles: number | null; message: string; snapshot: ScrapeRunSnapshotDto }
  >;
  [IpcChannel.Scraper_ConfirmUncensored]: IpcProcedure<ScrapeConfirmUncensoredInput, UncensoredConfirmResponse>;
};
