import { createClient } from "@egoist/tipc/renderer";
import type { Configuration } from "@shared/config";
import type { Website } from "@shared/enums";
import { IpcChannel } from "@shared/IpcChannel";
import type { IpcRouterContract } from "@shared/ipcContract";
import type { AppInfo, TranslateTestLlmInput } from "@shared/ipcTypes";
import type {
  CrawlerData,
  FileInfo,
  LocalScanEntry,
  MaintenanceCommitItem,
  MaintenanceItemResult,
  MaintenancePresetId,
  MaintenancePreviewResult,
  MaintenanceStatus,
  ScrapeResult,
  UncensoredConfirmItem,
  UncensoredConfirmResponse,
} from "@shared/types";

type Unsubscribe = () => void;

type LogPayload = {
  text: string;
  level?: "info" | "warn" | "error";
  timestamp: number;
};

type ProgressPayload = {
  value: number;
  current: number;
  total: number;
};

type ScrapeInfoPayload = {
  fileInfo: FileInfo;
  site: Website;
  step: "search" | "parse" | "download" | "organize";
};

type FailedInfoPayload = {
  fileInfo: FileInfo;
  error: string;
  site?: Website;
};

type ButtonStatusPayload = {
  startEnabled: boolean;
  stopEnabled: boolean;
};

type ShortcutPayload = {
  action: string;
  shortcut?: string;
};

const client = createClient<IpcRouterContract>({
  ipcInvoke: (channel, payload) => window.api.invoke(channel as IpcChannel, payload),
});

export const ipc = {
  app: {
    info: () => client[IpcChannel.App_Info](undefined) as Promise<AppInfo>,
    openExternal: (url: string) => client[IpcChannel.App_OpenExternal]({ url }),
  },
  config: {
    get: (path?: string) => client[IpcChannel.Config_Get]({ path }),
    save: (config?: Partial<Configuration>) => client[IpcChannel.Config_Save]({ config }),
    list: () => client[IpcChannel.Config_List](undefined),
    reset: (path?: string) => client[IpcChannel.Config_Reset]({ path }),
    previewNaming: (config?: Partial<Configuration>) => client[IpcChannel.Config_PreviewNaming]({ config }),
    listProfiles: () => client[IpcChannel.Config_ListProfiles](undefined),
    createProfile: (name: string) => client[IpcChannel.Config_CreateProfile]({ name }),
    switchProfile: (name: string) => client[IpcChannel.Config_SwitchProfile]({ name }),
    deleteProfile: (name: string) => client[IpcChannel.Config_DeleteProfile]({ name }),
  },
  scraper: {
    start: (mode: "single" | "batch", paths: string[]) => client[IpcChannel.Scraper_Start]({ mode, paths }),
    stop: () => client[IpcChannel.Scraper_Stop](undefined),
    pause: () => client[IpcChannel.Scraper_Pause](undefined),
    resume: () => client[IpcChannel.Scraper_Resume](undefined),
    getStatus: () => client[IpcChannel.Scraper_GetStatus](undefined),
    getFailedFiles: () => client[IpcChannel.Scraper_GetFailedFiles](undefined),
    requeue: (filePaths: string[]) => client[IpcChannel.Scraper_Requeue]({ filePaths }),
    retryFailed: (filePaths: string[]) => client[IpcChannel.Scraper_RetryFailed]({ filePaths }),
    hasRecoverableSession: () => client[IpcChannel.Scraper_HasRecoverableSession](undefined),
    recoverSession: () => client[IpcChannel.Scraper_RecoverSession](undefined),
    confirmUncensored: (items: UncensoredConfirmItem[]) =>
      client[IpcChannel.Scraper_ConfirmUncensored]({ items }) as Promise<UncensoredConfirmResponse>,
  },
  crawler: {
    test: (site: Website, number: string) => client[IpcChannel.Crawler_Test]({ site, number }),
    listSites: () => client[IpcChannel.Crawler_ListSites](undefined),
  },
  network: {
    checkCookies: () => client[IpcChannel.Network_CheckCookies](undefined),
  },
  translate: {
    testLlm: (input: TranslateTestLlmInput) =>
      client[IpcChannel.Translate_TestLlm](input) as Promise<{ success: boolean; message: string }>,
  },
  file: {
    listEntries: (dirPath: string) => client[IpcChannel.File_ListEntries]({ dirPath }),
    exists: (path: string) => client[IpcChannel.File_Exists]({ path }) as Promise<{ exists: boolean }>,
    browse: (type: "file" | "directory", filters?: Array<{ name: string; extensions: string[] }>) =>
      client[IpcChannel.File_Browse]({ type, filters }),
    delete: (filePaths: string[]) => client[IpcChannel.File_Delete]({ filePaths }),
    nfoRead: (nfoPath: string) => client[IpcChannel.File_NfoRead]({ nfoPath }),
    nfoWrite: (nfoPath: string, data: CrawlerData) => client[IpcChannel.File_NfoWrite]({ nfoPath, data }),
  },
  tool: {
    createSymlink: (payload: {
      sourceDir?: string;
      source_dir?: string;
      destDir?: string;
      dest_dir?: string;
      copyFiles?: boolean;
      copy_files?: boolean;
    }) => client[IpcChannel.Tool_CreateSymlink](payload),
    checkJellyfinConnection: () => client[IpcChannel.Tool_JellyfinServerCheckConnection](undefined),
    syncJellyfinActorPhoto: (mode: "all" | "missing") => client[IpcChannel.Tool_JellyfinActorPhotoSync]({ mode }),
    syncJellyfinActorInfo: (mode: "all" | "missing") => client[IpcChannel.Tool_JellyfinActorInfoSync]({ mode }),
    checkEmbyConnection: () => client[IpcChannel.Tool_EmbyServerCheckConnection](undefined),
    syncEmbyActorPhoto: (mode: "all" | "missing") => client[IpcChannel.Tool_EmbyActorPhotoSync]({ mode }),
    syncEmbyActorInfo: (mode: "all" | "missing") => client[IpcChannel.Tool_EmbyActorInfoSync]({ mode }),
    amazonPosterScan: (directory: string) => client[IpcChannel.Tool_AmazonPosterScan]({ directory }),
    amazonPosterLookup: (nfoPath: string, title: string) =>
      client[IpcChannel.Tool_AmazonPosterLookup]({ nfoPath, title }),
    amazonPosterApply: (items: Array<{ directory: string; amazonPosterUrl: string }>) =>
      client[IpcChannel.Tool_AmazonPosterApply]({ items }),
    toggleDevTools: () => client[IpcChannel.Tool_ToggleDevTools](undefined),
  },
  maintenance: {
    scan: (dirPath: string) =>
      client[IpcChannel.Maintenance_Scan]({ dirPath }) as Promise<{ entries: LocalScanEntry[] }>,
    preview: (entries: LocalScanEntry[], presetId: MaintenancePresetId) =>
      client[IpcChannel.Maintenance_Preview]({ entries, presetId }) as Promise<MaintenancePreviewResult>,
    execute: (items: MaintenanceCommitItem[], presetId: MaintenancePresetId) =>
      client[IpcChannel.Maintenance_Execute]({ items, presetId }),
    stop: () => client[IpcChannel.Maintenance_Stop](undefined),
    getStatus: () => client[IpcChannel.Maintenance_GetStatus](undefined) as Promise<MaintenanceStatus>,
  },
  on: {
    log: (callback: (payload: LogPayload) => void): Unsubscribe => window.api.on(IpcChannel.Event_Log, callback),
    progress: (callback: (payload: ProgressPayload) => void): Unsubscribe =>
      window.api.on(IpcChannel.Event_Progress, callback),
    scrapeResult: (callback: (payload: ScrapeResult) => void): Unsubscribe =>
      window.api.on(IpcChannel.Event_ScrapeResult, callback),
    scrapeInfo: (callback: (payload: ScrapeInfoPayload) => void): Unsubscribe =>
      window.api.on(IpcChannel.Event_ScrapeInfo, callback),
    failedInfo: (callback: (payload: FailedInfoPayload) => void): Unsubscribe =>
      window.api.on(IpcChannel.Event_FailedInfo, callback),
    buttonStatus: (callback: (payload: ButtonStatusPayload) => void): Unsubscribe =>
      window.api.on(IpcChannel.Event_ButtonStatus, callback),
    shortcut: (callback: (payload: ShortcutPayload) => void): Unsubscribe =>
      window.api.on(IpcChannel.Event_Shortcut, callback),
    maintenanceItemResult: (callback: (payload: MaintenanceItemResult) => void): Unsubscribe =>
      window.api.on(IpcChannel.Event_MaintenanceItemResult, callback),
  },
};
