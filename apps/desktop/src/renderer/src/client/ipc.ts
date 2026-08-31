import { createClient } from "@egoist/tipc/renderer";
import type { Configuration } from "@mdcz/shared/config";
import type { Website } from "@mdcz/shared/enums";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import type { ScraperStartInput } from "@mdcz/shared/ipc-contracts/scraperContract";
import type { IpcRouterContract } from "@mdcz/shared/ipcContract";
import type { InvalidatePayload, LogPayload, ShortcutPayload } from "@mdcz/shared/ipcEvents";
import type { BatchTranslateApplyInput, TranslateTestLlmInput } from "@mdcz/shared/ipcTypes";
import type { MaintenanceApplySelection } from "@mdcz/shared/maintenanceTasks";
import type { LocalFileTarget, RootFileRef } from "@mdcz/shared/mediaRef";
import type { NormalizedCropRegion } from "@mdcz/shared/posterCrop";
import type { LibraryListInput, MediaRootEnsurePathInput, MediaRootEnsurePathResponse } from "@mdcz/shared/serverDtos";
import type { CrawlerData, MaintenancePresetId, MediaCandidate, UncensoredConfirmItem } from "@mdcz/shared/types";

type Unsubscribe = () => void;

const client = createClient<IpcRouterContract>({
  ipcInvoke: (channel, payload) => window.api.invoke(channel as IpcChannel, payload),
});

export const ipc = {
  app: {
    info: () => client[IpcChannel.App_Info](undefined),
    openExternal: (url: string) => client[IpcChannel.App_OpenExternal]({ url }),
    playMedia: (path: LocalFileTarget) => client[IpcChannel.App_PlayMedia]({ path }),
    showItemInFolder: (path: LocalFileTarget) => client[IpcChannel.App_ShowItemInFolder]({ path }),
    ensureWatermarkDirectory: () => client[IpcChannel.App_EnsureWatermarkDirectory](undefined),
    openWatermarkDirectory: () => client[IpcChannel.App_OpenWatermarkDirectory](undefined),
    relaunch: () => client[IpcChannel.App_Relaunch](undefined),
    syncTitleBarTheme: (isDark: boolean) => client[IpcChannel.App_SyncTitleBarTheme]({ isDark }),
  },
  overview: {
    getRecentAcquisitions: () => client[IpcChannel.Overview_GetRecentAcquisitions](undefined),
    removeRecentAcquisition: (id: string) => client[IpcChannel.Overview_RemoveRecentAcquisition]({ id }),
    getOutputSummary: () => client[IpcChannel.Overview_GetOutputSummary](undefined),
  },
  library: {
    availability: (ids: string[]) => client[IpcChannel.Library_Availability]({ ids }),
    list: (input?: LibraryListInput) => client[IpcChannel.Library_List](input),
    delete: (input: { deleteMode?: "none" | "assets" | "all"; id: string }) => client[IpcChannel.Library_Delete](input),
  },
  mediaRoots: {
    ensurePath: (input: MediaRootEnsurePathInput) =>
      client[IpcChannel.MediaRoots_EnsurePath](input) as Promise<MediaRootEnsurePathResponse>,
    prepareOutputDirectory: (input: MediaRootEnsurePathInput) =>
      client[IpcChannel.MediaRoots_PrepareOutputDirectory](input) as Promise<MediaRootEnsurePathResponse>,
  },
  config: {
    get: (path?: string) => client[IpcChannel.Config_Get]({ path }),
    getDefaults: () => client[IpcChannel.Config_GetDefaults](undefined),
    save: (config?: Partial<Configuration>) => client[IpcChannel.Config_Save]({ config }),
    list: () => client[IpcChannel.Config_List](undefined),
    reset: (path?: string) => client[IpcChannel.Config_Reset]({ path }),
    previewNaming: (config?: Partial<Configuration>) => client[IpcChannel.Config_PreviewNaming]({ config }),
    listProfiles: () => client[IpcChannel.Config_ListProfiles](undefined),
    createProfile: (name: string) => client[IpcChannel.Config_CreateProfile]({ name }),
    switchProfile: (name: string) => client[IpcChannel.Config_SwitchProfile]({ name }),
    deleteProfile: (name: string) => client[IpcChannel.Config_DeleteProfile]({ name }),
    exportProfile: (name: string) => client[IpcChannel.Config_ExportProfile]({ name }),
    importProfile: (filePath: string, name: string, overwrite = false) =>
      client[IpcChannel.Config_ImportProfile]({ filePath, name, overwrite }),
  },
  scraper: {
    start: (input: ScraperStartInput) => client[IpcChannel.Scraper_Start](input),
    startSinglePath: (path: string) => client[IpcChannel.Scraper_StartSinglePath]({ path }),
    stop: () => client[IpcChannel.Scraper_Stop](undefined),
    pause: () => client[IpcChannel.Scraper_Pause](undefined),
    resume: () => client[IpcChannel.Scraper_Resume](undefined),
    getStatus: (taskId?: string) => client[IpcChannel.Scraper_GetStatus]({ taskId }),
    retry: (runId: string, itemIds?: readonly string[]) =>
      client[IpcChannel.Scraper_Retry]({ runId, ...(itemIds ? { itemIds: [...itemIds] } : {}) }),
    confirmUncensored: (items: UncensoredConfirmItem[]) => client[IpcChannel.Scraper_ConfirmUncensored]({ items }),
  },
  crawler: {
    test: (site: Website, number: string) => client[IpcChannel.Crawler_Test]({ site, number }),
    listSites: () => client[IpcChannel.Crawler_ListSites](undefined),
    probeSiteConnectivity: (site: Website) => client[IpcChannel.Crawler_ProbeSiteConnectivity]({ site }),
  },
  network: {
    checkCookies: () => client[IpcChannel.Network_CheckCookies](undefined),
  },
  translate: {
    testLlm: (input: TranslateTestLlmInput) => client[IpcChannel.Translate_TestLlm](input),
  },
  file: {
    listMediaCandidates: (dirPath: string, excludeDirPaths?: readonly string[]) =>
      client[IpcChannel.File_ListMediaCandidates]({
        dirPath,
        excludeDirPaths: excludeDirPaths ? [...excludeDirPaths] : undefined,
      }) as Promise<{
        candidates: MediaCandidate[];
        supportedExtensions: string[];
      }>,
    exists: (path: LocalFileTarget) =>
      client[IpcChannel.File_Exists]({ path }) as Promise<{ exists: boolean; url?: string }>,
    browse: (type: "file" | "directory", filters?: Array<{ name: string; extensions: string[] }>) =>
      client[IpcChannel.File_Browse]({ type, filters }),
    delete: (targets: RootFileRef[], containingFolder?: boolean) =>
      client[IpcChannel.File_Delete]({ targets, containingFolder }),
    nfoRead: (nfoPath: LocalFileTarget, videoPath?: LocalFileTarget) =>
      client[IpcChannel.File_NfoRead]({ nfoPath, videoPath }),
    nfoWrite: (nfoPath: LocalFileTarget, data: CrawlerData, videoPath?: LocalFileTarget) =>
      client[IpcChannel.File_NfoWrite]({ nfoPath, videoPath, data }),
    posterCropSession: (videoPath: LocalFileTarget) => client[IpcChannel.File_PosterCropSession]({ videoPath }),
    posterCropSave: (videoPath: LocalFileTarget, crop: NormalizedCropRegion) =>
      client[IpcChannel.File_PosterCropSave]({ videoPath, crop }),
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
    amazonPosterApply: (items: Array<{ nfoPath: string; amazonPosterUrl: string }>) =>
      client[IpcChannel.Tool_AmazonPosterApply]({ items }),
    batchTranslateScan: (directory: string) => client[IpcChannel.Tool_BatchTranslateScan]({ directory }),
    batchTranslateApply: (input: BatchTranslateApplyInput) => client[IpcChannel.Tool_BatchTranslateApply](input),
    toggleDevTools: () => client[IpcChannel.Tool_ToggleDevTools](undefined),
  },
  maintenance: {
    preview: (refs: RootFileRef[], presetId: MaintenancePresetId) =>
      client[IpcChannel.Maintenance_StartPreview]({ refs, presetId }),
    execute: (selections: MaintenanceApplySelection[], presetId: MaintenancePresetId) =>
      client[IpcChannel.Maintenance_Apply]({ selections, presetId }),
    stop: () => client[IpcChannel.Maintenance_Stop](undefined),
    pause: () => client[IpcChannel.Maintenance_Pause](undefined),
    resume: () => client[IpcChannel.Maintenance_Resume](undefined),
    getActiveSession: () => client[IpcChannel.Maintenance_ReadSnapshot](undefined),
    updateDraft: (input: { previewId: string; fieldSelections?: Record<string, "old" | "new"> }) =>
      client[IpcChannel.Maintenance_UpdateDraft](input),
    discardSession: () => client[IpcChannel.Maintenance_DiscardSession](undefined),
  },
  on: {
    log: (callback: (payload: LogPayload) => void): Unsubscribe => window.api.on(IpcChannel.Event_Log, callback),
    invalidate: (callback: (payload: InvalidatePayload) => void): Unsubscribe =>
      window.api.on(IpcChannel.Event_Invalidate, callback),
    shortcut: (callback: (payload: ShortcutPayload) => void): Unsubscribe =>
      window.api.on(IpcChannel.Event_Shortcut, callback),
  },
};
