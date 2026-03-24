import type { Configuration } from "./config";
import type { Website } from "./enums";
import { IpcChannel } from "./IpcChannel";
import type {
  AmazonPosterApplyResultItem,
  AmazonPosterLookupResult,
  AmazonPosterScanItem,
  AppInfo,
  EmbyConnectionCheckResult,
  IpcProcedure,
  JellyfinConnectionCheckResult,
  TranslateTestLlmInput,
} from "./ipcTypes";
import type {
  CrawlerData,
  LocalScanEntry,
  MaintenanceCommitItem,
  MaintenancePresetId,
  MaintenancePreviewResult,
  MaintenanceStatus,
  NamingPreviewItem,
  ScraperStatus,
  UncensoredConfirmItem,
  UncensoredConfirmResponse,
} from "./types";

export type IpcRouterContract = {
  [IpcChannel.App_Info]: IpcProcedure<void, AppInfo>;
  [IpcChannel.App_OpenExternal]: IpcProcedure<{ url: string }, { success: true }>;
  [IpcChannel.Config_Get]: IpcProcedure<{ path?: string }, Configuration | unknown>;
  [IpcChannel.Config_Save]: IpcProcedure<{ config?: Partial<Configuration> }, { success: true }>;
  [IpcChannel.Config_List]: IpcProcedure<void, { configPath: string; dataDir: string }>;
  [IpcChannel.Config_Reset]: IpcProcedure<{ path?: string }, { success: true }>;
  [IpcChannel.Config_PreviewNaming]: IpcProcedure<{ config?: Partial<Configuration> }, { items: NamingPreviewItem[] }>;
  [IpcChannel.Config_ListProfiles]: IpcProcedure<void, { profiles: string[]; active: string }>;
  [IpcChannel.Config_CreateProfile]: IpcProcedure<{ name?: string }, { success: true }>;
  [IpcChannel.Config_SwitchProfile]: IpcProcedure<{ name?: string }, { success: true }>;
  [IpcChannel.Config_DeleteProfile]: IpcProcedure<{ name?: string }, { success: true }>;

  [IpcChannel.Scraper_Start]: IpcProcedure<
    { mode?: "single" | "batch"; paths?: string[] },
    { taskId: string; totalFiles: number }
  >;
  [IpcChannel.Scraper_Stop]: IpcProcedure<void, { success: true; pendingCount: number }>;
  [IpcChannel.Scraper_Pause]: IpcProcedure<void, { success: true }>;
  [IpcChannel.Scraper_Resume]: IpcProcedure<void, { success: true }>;
  [IpcChannel.Scraper_GetStatus]: IpcProcedure<void, ScraperStatus>;
  [IpcChannel.Scraper_GetFailedFiles]: IpcProcedure<void, { filePaths: string[] }>;
  [IpcChannel.Scraper_Requeue]: IpcProcedure<{ filePaths?: string[] }, { requeuedCount: number }>;
  [IpcChannel.Scraper_RetryFailed]: IpcProcedure<{ filePaths?: string[] }, { taskId: string; totalFiles: number }>;
  [IpcChannel.Scraper_HasRecoverableSession]: IpcProcedure<void, { recoverable: boolean }>;
  [IpcChannel.Scraper_RecoverSession]: IpcProcedure<void, { taskId: string; totalFiles: number }>;
  [IpcChannel.Scraper_ConfirmUncensored]: IpcProcedure<{ items?: UncensoredConfirmItem[] }, UncensoredConfirmResponse>;

  [IpcChannel.Crawler_Test]: IpcProcedure<
    { site?: Website; number?: string },
    { data: CrawlerData | null; error?: string; elapsed: number }
  >;
  [IpcChannel.Crawler_ListSites]: IpcProcedure<void, unknown>;

  [IpcChannel.Network_CheckCookies]: IpcProcedure<
    void,
    { results: Array<{ site: string; valid: boolean; message: string }> }
  >;

  [IpcChannel.Translate_TestLlm]: IpcProcedure<TranslateTestLlmInput, { success: boolean; message: string }>;
  [IpcChannel.File_ListEntries]: IpcProcedure<
    { dirPath?: string },
    {
      entries: Array<{
        type: "file" | "directory";
        path: string;
        name: string;
        size?: number;
        lastModified?: string | null;
      }>;
    }
  >;
  [IpcChannel.File_Exists]: IpcProcedure<{ path?: string }, { exists: boolean }>;
  [IpcChannel.File_Browse]: IpcProcedure<
    { type?: "file" | "directory"; filters?: Array<{ name: string; extensions: string[] }> },
    { paths: string[] | null }
  >;
  [IpcChannel.File_Delete]: IpcProcedure<{ filePaths?: string[] }, { deletedCount: number; failedCount: number }>;
  [IpcChannel.File_NfoRead]: IpcProcedure<{ nfoPath?: string }, { data: CrawlerData }>;
  [IpcChannel.File_NfoWrite]: IpcProcedure<{ nfoPath?: string; data?: CrawlerData }, { success: true }>;

  [IpcChannel.Tool_AmazonPosterScan]: IpcProcedure<{ directory?: string }, { items: AmazonPosterScanItem[] }>;
  [IpcChannel.Tool_AmazonPosterLookup]: IpcProcedure<{ nfoPath?: string; title?: string }, AmazonPosterLookupResult>;
  [IpcChannel.Tool_AmazonPosterApply]: IpcProcedure<
    { items?: Array<{ directory: string; amazonPosterUrl: string }> },
    { results: AmazonPosterApplyResultItem[] }
  >;

  [IpcChannel.Tool_CreateSymlink]: IpcProcedure<
    {
      sourceDir?: string;
      source_dir?: string;
      destDir?: string;
      dest_dir?: string;
      copyFiles?: boolean;
      copy_files?: boolean;
    },
    { message: string }
  >;
  [IpcChannel.Tool_JellyfinServerCheckConnection]: IpcProcedure<void, JellyfinConnectionCheckResult>;
  [IpcChannel.Tool_JellyfinActorPhotoSync]: IpcProcedure<
    { mode?: "all" | "missing" },
    { processedCount: number; failedCount: number }
  >;
  [IpcChannel.Tool_JellyfinActorInfoSync]: IpcProcedure<
    { mode?: "all" | "missing" },
    { processedCount: number; failedCount: number }
  >;
  [IpcChannel.Tool_EmbyServerCheckConnection]: IpcProcedure<void, EmbyConnectionCheckResult>;
  [IpcChannel.Tool_EmbyActorPhotoSync]: IpcProcedure<
    { mode?: "all" | "missing" },
    { processedCount: number; failedCount: number }
  >;
  [IpcChannel.Tool_EmbyActorInfoSync]: IpcProcedure<
    { mode?: "all" | "missing" },
    { processedCount: number; failedCount: number }
  >;
  [IpcChannel.Tool_ToggleDevTools]: IpcProcedure<void, { success: true }>;

  [IpcChannel.Maintenance_Scan]: IpcProcedure<{ dirPath?: string }, { entries: LocalScanEntry[] }>;
  [IpcChannel.Maintenance_Preview]: IpcProcedure<
    { entries?: LocalScanEntry[]; presetId?: MaintenancePresetId },
    MaintenancePreviewResult
  >;
  [IpcChannel.Maintenance_Execute]: IpcProcedure<
    { items?: MaintenanceCommitItem[]; presetId?: MaintenancePresetId },
    { success: true }
  >;
  [IpcChannel.Maintenance_Stop]: IpcProcedure<void, { success: true }>;
  [IpcChannel.Maintenance_GetStatus]: IpcProcedure<void, MaintenanceStatus>;
};
