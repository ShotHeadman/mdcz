import { IpcChannel } from "./IpcChannel";
import type { IpcRouterContract } from "./ipcContract";
import type { ServerApiContract } from "./serverApi";

type FlattenServerPaths<T, Prefix extends string = ""> = {
  [Key in keyof T & string]: T[Key] extends (...args: never) => unknown
    ? `${Prefix}${Key}`
    : T[Key] extends object
      ? FlattenServerPaths<T[Key], `${Prefix}${Key}.`>
      : never;
}[keyof T & string];

export type FlattenedServerPath = FlattenServerPaths<ServerApiContract>;

export interface CapabilityOverlapPair {
  id: string;
  desktop: keyof IpcRouterContract;
  server: FlattenedServerPath;
}

export interface ClassifiedChannel {
  channel: IpcChannel;
  reason: string;
}

export interface ClassifiedServerProcedure {
  path: FlattenedServerPath;
  reason: string;
}

export const CAPABILITY_OVERLAP_PAIRS = [
  {
    id: "app.ensureWatermarkDirectory",
    desktop: IpcChannel.App_EnsureWatermarkDirectory,
    server: "app.ensureWatermarkDirectory",
  },
  { id: "config.defaults", desktop: IpcChannel.Config_GetDefaults, server: "config.defaults" },
  { id: "config.previewNaming", desktop: IpcChannel.Config_PreviewNaming, server: "config.previewNaming" },
  { id: "config.profiles.create", desktop: IpcChannel.Config_CreateProfile, server: "config.profiles.create" },
  { id: "config.profiles.delete", desktop: IpcChannel.Config_DeleteProfile, server: "config.profiles.delete" },
  { id: "config.profiles.export", desktop: IpcChannel.Config_ExportProfile, server: "config.profiles.export" },
  { id: "config.profiles.import", desktop: IpcChannel.Config_ImportProfile, server: "config.profiles.import" },
  { id: "config.profiles.list", desktop: IpcChannel.Config_ListProfiles, server: "config.profiles.list" },
  { id: "config.profiles.switch", desktop: IpcChannel.Config_SwitchProfile, server: "config.profiles.switch" },
  { id: "config.read", desktop: IpcChannel.Config_Get, server: "config.read" },
  { id: "config.reset", desktop: IpcChannel.Config_Reset, server: "config.reset" },
  { id: "config.save", desktop: IpcChannel.Config_Save, server: "config.save" },
  { id: "crawler.listSites", desktop: IpcChannel.Crawler_ListSites, server: "crawler.listSites" },
  {
    id: "crawler.probeSiteConnectivity",
    desktop: IpcChannel.Crawler_ProbeSiteConnectivity,
    server: "crawler.probeSiteConnectivity",
  },
  { id: "library.availability", desktop: IpcChannel.Library_Availability, server: "library.availability" },
  { id: "library.delete", desktop: IpcChannel.Library_Delete, server: "library.delete" },
  { id: "library.list", desktop: IpcChannel.Library_List, server: "library.list" },
  { id: "maintenance.apply", desktop: IpcChannel.Maintenance_Execute, server: "maintenance.apply" },
  { id: "maintenance.pause", desktop: IpcChannel.Maintenance_Pause, server: "maintenance.pause" },
  { id: "maintenance.preview", desktop: IpcChannel.Maintenance_Preview, server: "maintenance.preview" },
  { id: "maintenance.resume", desktop: IpcChannel.Maintenance_Resume, server: "maintenance.resume" },
  {
    id: "maintenance.scanSelectedFiles",
    desktop: IpcChannel.Maintenance_Scan,
    server: "maintenance.scanSelectedFiles",
  },
  { id: "maintenance.stop", desktop: IpcChannel.Maintenance_Stop, server: "maintenance.stop" },
  { id: "network.checkCookies", desktop: IpcChannel.Network_CheckCookies, server: "network.checkCookies" },
  {
    id: "overview.removeRecentAcquisition",
    desktop: IpcChannel.Overview_RemoveRecentAcquisition,
    server: "overview.removeRecentAcquisition",
  },
  { id: "scrape.confirmUncensored", desktop: IpcChannel.Scraper_ConfirmUncensored, server: "scrape.confirmUncensored" },
  {
    id: "scrape.getRecoverableSession",
    desktop: IpcChannel.Scraper_GetRecoverableSession,
    server: "scrape.getRecoverableSession",
  },
  { id: "scrape.nfoRead", desktop: IpcChannel.File_NfoRead, server: "scrape.nfoRead" },
  { id: "scrape.nfoWrite", desktop: IpcChannel.File_NfoWrite, server: "scrape.nfoWrite" },
  { id: "scrape.pause", desktop: IpcChannel.Scraper_Pause, server: "scrape.pause" },
  { id: "scrape.posterCropSave", desktop: IpcChannel.File_PosterCropSave, server: "scrape.posterCropSave" },
  { id: "scrape.posterCropSession", desktop: IpcChannel.File_PosterCropSession, server: "scrape.posterCropSession" },
  {
    id: "scrape.resolveRecoverableSession",
    desktop: IpcChannel.Scraper_ResolveRecoverableSession,
    server: "scrape.resolveRecoverableSession",
  },
  { id: "scrape.resume", desktop: IpcChannel.Scraper_Resume, server: "scrape.resume" },
  { id: "scrape.retry", desktop: IpcChannel.Scraper_RetryFailed, server: "scrape.retry" },
  { id: "scrape.start", desktop: IpcChannel.Scraper_Start, server: "scrape.start" },
  { id: "scrape.stop", desktop: IpcChannel.Scraper_Stop, server: "scrape.stop" },
  { id: "translate.testLlm", desktop: IpcChannel.Translate_TestLlm, server: "translate.testLlm" },
] as const satisfies readonly CapabilityOverlapPair[];

export const DESKTOP_ONLY_CHANNELS = [
  {
    channel: IpcChannel.App_Info,
    reason: "Desktop process identity; server equivalent is system.about with a different product surface.",
  },
  { channel: IpcChannel.App_OpenExternal, reason: "Electron shell: open a URL in the OS browser." },
  { channel: IpcChannel.App_OpenWatermarkDirectory, reason: "Electron shell: reveal a local directory." },
  { channel: IpcChannel.App_PlayMedia, reason: "Electron shell: play a local media path." },
  { channel: IpcChannel.App_Relaunch, reason: "Electron shell: relaunch the desktop process." },
  { channel: IpcChannel.App_ShowItemInFolder, reason: "Electron shell: reveal a local file in the OS file manager." },
  { channel: IpcChannel.App_SyncTitleBarTheme, reason: "Electron title-bar overlay theming." },
  { channel: IpcChannel.Config_List, reason: "Returns desktop configPath/dataDir; no server procedure." },
  {
    channel: IpcChannel.Crawler_Test,
    reason: "Desktop crawler tester; server exposes crawler-tester through tools.execute, not a 1:1 procedure.",
  },
  { channel: IpcChannel.Event_ButtonStatus, reason: "Unidirectional desktop event push; no server procedure." },
  { channel: IpcChannel.Event_FailedInfo, reason: "Unidirectional desktop event push; no server procedure." },
  { channel: IpcChannel.Event_Log, reason: "Unidirectional desktop event push; no server procedure." },
  {
    channel: IpcChannel.Event_MaintenanceItemResult,
    reason: "Unidirectional desktop event push; no server procedure.",
  },
  { channel: IpcChannel.Event_Progress, reason: "Unidirectional desktop event push; no server procedure." },
  { channel: IpcChannel.Event_ScrapeInfo, reason: "Unidirectional desktop event push; no server procedure." },
  { channel: IpcChannel.Event_ScrapeResult, reason: "Unidirectional desktop event push; no server procedure." },
  { channel: IpcChannel.Event_Shortcut, reason: "Unidirectional desktop event push; no server procedure." },
  { channel: IpcChannel.File_Browse, reason: "Native file dialog; no server procedure." },
  {
    channel: IpcChannel.File_Delete,
    reason: "Deletes by absolute path; server scrape.deleteFile is root-relative and not 1:1.",
  },
  { channel: IpcChannel.File_Exists, reason: "Local filesystem probe." },
  {
    channel: IpcChannel.File_ListEntries,
    reason: "Local filesystem listing; server browser.list is media-root scoped.",
  },
  {
    channel: IpcChannel.File_ListMediaCandidates,
    reason: "Local filesystem probe; server scans.candidates is media-root scoped.",
  },
  {
    channel: IpcChannel.Maintenance_GetStatus,
    reason: "Desktop in-process maintenance session status; server uses task DTOs.",
  },
  { channel: IpcChannel.Overview_GetOutputSummary, reason: "Desktop-only split of overview.summary." },
  { channel: IpcChannel.Overview_GetRecentAcquisitions, reason: "Desktop-only split of overview.summary." },
  {
    channel: IpcChannel.Scraper_GetFailedFiles,
    reason: "Desktop in-process scrape session; server uses scrape.listResults.",
  },
  { channel: IpcChannel.Scraper_GetStatus, reason: "Desktop in-process scrape session; server uses task DTOs." },
  { channel: IpcChannel.Scraper_Requeue, reason: "Desktop in-process requeue; server retry is task-scoped." },
  {
    channel: IpcChannel.Tool_AmazonPosterApply,
    reason: "Tool_* family is N:2 against tools.execute; deferred from 1:1 manifest.",
  },
  {
    channel: IpcChannel.Tool_AmazonPosterLookup,
    reason: "Tool_* family is N:2 against tools.execute; deferred from 1:1 manifest.",
  },
  {
    channel: IpcChannel.Tool_AmazonPosterScan,
    reason: "Tool_* family is N:2 against tools.execute; deferred from 1:1 manifest.",
  },
  {
    channel: IpcChannel.Tool_BatchTranslateApply,
    reason: "Tool_* family is N:2 against tools.execute; deferred from 1:1 manifest.",
  },
  {
    channel: IpcChannel.Tool_BatchTranslateScan,
    reason: "Tool_* family is N:2 against tools.execute; deferred from 1:1 manifest.",
  },
  {
    channel: IpcChannel.Tool_CreateSymlink,
    reason: "Tool_* family is N:2 against tools.execute; deferred from 1:1 manifest.",
  },
  {
    channel: IpcChannel.Tool_EmbyActorInfoSync,
    reason: "Tool_* family is N:2 against tools.execute; deferred from 1:1 manifest.",
  },
  {
    channel: IpcChannel.Tool_EmbyActorPhotoSync,
    reason: "Tool_* family is N:2 against tools.execute; deferred from 1:1 manifest.",
  },
  {
    channel: IpcChannel.Tool_EmbyServerCheckConnection,
    reason: "Tool_* family is N:2 against tools.execute; deferred from 1:1 manifest.",
  },
  {
    channel: IpcChannel.Tool_JellyfinActorInfoSync,
    reason: "Tool_* family is N:2 against tools.execute; deferred from 1:1 manifest.",
  },
  {
    channel: IpcChannel.Tool_JellyfinActorPhotoSync,
    reason: "Tool_* family is N:2 against tools.execute; deferred from 1:1 manifest.",
  },
  {
    channel: IpcChannel.Tool_JellyfinServerCheckConnection,
    reason: "Tool_* family is N:2 against tools.execute; deferred from 1:1 manifest.",
  },
  { channel: IpcChannel.Tool_ToggleDevTools, reason: "Electron DevTools toggle; no server procedure." },
] as const satisfies readonly ClassifiedChannel[];

export const SERVER_ONLY_PROCEDURES = [
  { path: "auth.login", reason: "Server host authentication." },
  { path: "auth.logout", reason: "Server host authentication." },
  { path: "auth.setup", reason: "Server host authentication." },
  { path: "auth.status", reason: "Server host authentication." },
  { path: "browser.list", reason: "Media-root scoped browser; desktop File_ListEntries is absolute-path local FS." },
  {
    path: "config.export",
    reason: "Server exports config as a string; desktop profile export is a native save dialog.",
  },
  {
    path: "config.import",
    reason: "Server imports config from a string; desktop profile import is a native open dialog.",
  },
  { path: "config.update", reason: "Partial live update; desktop persists through Config_Save." },
  { path: "health.read", reason: "Server process health." },
  { path: "library.detail", reason: "Server-only library item view." },
  { path: "library.refresh", reason: "Server-only library item refresh." },
  { path: "library.relink", reason: "Server-only library relink." },
  { path: "library.rescan", reason: "Server-only per-item rescan." },
  { path: "library.search", reason: "Server alias of library.list; desktop has a single Library_List channel." },
  { path: "logs.clearRuntime", reason: "Server log store." },
  { path: "logs.list", reason: "Server log store." },
  { path: "maintenance.recover", reason: "Server task recovery; desktop has no matching channel." },
  { path: "maintenance.start", reason: "Server starts a persisted maintenance task; desktop scan is in-process." },
  { path: "mediaRoots.list", reason: "Server media-root catalog." },
  {
    path: "overview.summary",
    reason: "Combines desktop Overview_GetRecentAcquisitions and Overview_GetOutputSummary.",
  },
  { path: "persistence.status", reason: "Server database status." },
  {
    path: "scans.candidates",
    reason: "Media-root scoped scan candidates; desktop File_ListMediaCandidates is local FS.",
  },
  { path: "scans.detail", reason: "Server scan task API." },
  { path: "scans.events", reason: "Server scan task API." },
  { path: "scans.list", reason: "Server scan task API." },
  { path: "scans.retry", reason: "Server scan task API." },
  { path: "scans.start", reason: "Server scan task API." },
  { path: "scrape.deleteFile", reason: "Root-relative delete; desktop File_Delete uses absolute paths." },
  {
    path: "scrape.listResults",
    reason: "Server persisted scrape results; desktop uses Event_ScrapeResult / GetFailedFiles.",
  },
  { path: "scrape.result", reason: "Server persisted scrape result detail." },
  { path: "scrape.startSelectedFiles", reason: "Server split of desktop Scraper_Start selection mode." },
  { path: "serverPaths.suggest", reason: "Server filesystem path suggest." },
  { path: "setup.complete", reason: "Server first-run setup." },
  { path: "setup.status", reason: "Server first-run setup." },
  { path: "system.about", reason: "Server product/about surface; desktop App_Info is process identity." },
  { path: "tasks.detail", reason: "Server task store." },
  { path: "tasks.events", reason: "Server task store." },
  { path: "tasks.list", reason: "Server task store." },
  { path: "tasks.retry", reason: "Server task store." },
  { path: "tools.catalog", reason: "Tool_* family is N:2; deferred from 1:1 manifest." },
  { path: "tools.execute", reason: "Tool_* family is N:2; deferred from 1:1 manifest." },
] as const satisfies readonly ClassifiedServerProcedure[];

type ClassifiedDesktopChannel =
  | (typeof CAPABILITY_OVERLAP_PAIRS)[number]["desktop"]
  | (typeof DESKTOP_ONLY_CHANNELS)[number]["channel"];
type UnclassifiedDesktopChannel = Exclude<IpcChannel, ClassifiedDesktopChannel>;
type ExtraDesktopChannel = Exclude<ClassifiedDesktopChannel, IpcChannel>;

type ClassifiedServerPath =
  | (typeof CAPABILITY_OVERLAP_PAIRS)[number]["server"]
  | (typeof SERVER_ONLY_PROCEDURES)[number]["path"];
type UnclassifiedServerPath = Exclude<FlattenedServerPath, ClassifiedServerPath>;
type ExtraServerPath = Exclude<ClassifiedServerPath, FlattenedServerPath>;

type AssertExhaustive<T> = [T] extends [never] ? true : T;

export type CapabilityInventoryDesktopExhaustive = AssertExhaustive<UnclassifiedDesktopChannel | ExtraDesktopChannel>;
export type CapabilityInventoryServerExhaustive = AssertExhaustive<UnclassifiedServerPath | ExtraServerPath>;
