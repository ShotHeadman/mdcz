export enum IpcChannel {
  Config_Get = "config:get",
  Config_GetDefaults = "config:get-defaults",
  Config_Save = "config:save",
  Config_List = "config:list",
  Config_Reset = "config:reset",
  Config_PreviewNaming = "config:preview-naming",
  Config_ListProfiles = "config:list-profiles",
  Config_CreateProfile = "config:create-profile",
  Config_SwitchProfile = "config:switch-profile",
  Config_DeleteProfile = "config:delete-profile",
  Config_ExportProfile = "config:export-profile",
  Config_ImportProfile = "config:import-profile",

  Scraper_Start = "scraper:start",
  Scraper_StartSinglePath = "scraper:start-single-path",
  Scraper_Stop = "scraper:stop",
  Scraper_Pause = "scraper:pause",
  Scraper_Resume = "scraper:resume",
  Scraper_GetStatus = "scraper:get-status",
  Scraper_Retry = "scraper:retry",
  Scraper_ConfirmUncensored = "scraper:confirm-uncensored",

  Crawler_Test = "crawler:test",
  Crawler_ListSites = "crawler:list-sites",
  Crawler_ProbeSiteConnectivity = "crawler:probe-site-connectivity",

  Network_CheckCookies = "network:check-cookies",

  Translate_TestLlm = "translate:test-llm",
  File_ListMediaCandidates = "file:list-media-candidates",
  File_Exists = "file:exists",
  File_Browse = "file:browse",
  File_Delete = "file:delete",
  File_NfoRead = "file:nfo-read",
  File_NfoWrite = "file:nfo-write",
  File_PosterCropSession = "file:poster-crop-session",
  File_PosterCropSave = "file:poster-crop-save",

  Event_Log = "event:log",
  Event_Invalidate = "event:invalidate",
  Event_Shortcut = "event:shortcut",

  App_Info = "app:info",
  App_OpenExternal = "app:open-external",
  App_PlayMedia = "app:play-media",
  App_ShowItemInFolder = "app:show-item-in-folder",
  App_EnsureWatermarkDirectory = "app:ensure-watermark-directory",
  App_OpenWatermarkDirectory = "app:open-watermark-directory",
  App_Relaunch = "app:relaunch",
  App_SyncTitleBarTheme = "app:sync-titlebar-theme",

  Overview_GetRecentAcquisitions = "overview:get-recent-acquisitions",
  Overview_RemoveRecentAcquisition = "overview:remove-recent-acquisition",
  Overview_GetOutputSummary = "overview:get-output-summary",

  Library_List = "library:list",
  Library_Availability = "library:availability",
  Library_Delete = "library:delete",

  MediaRoots_EnsurePath = "mediaRoots:ensurePath",
  MediaRoots_PrepareOutputDirectory = "mediaRoots:prepare-output-directory",

  Tool_JellyfinActorPhotoSync = "tool:jellyfin-actor-photo-sync",
  Tool_JellyfinActorInfoSync = "tool:jellyfin-actor-info-sync",
  Tool_JellyfinServerCheckConnection = "tool:jellyfin-server-check-connection",
  Tool_EmbyActorPhotoSync = "tool:emby-actor-photo-sync",
  Tool_EmbyActorInfoSync = "tool:emby-actor-info-sync",
  Tool_EmbyServerCheckConnection = "tool:emby-server-check-connection",
  Tool_CreateSymlink = "tool:create-symlink",
  Tool_AmazonPosterScan = "tool:amazon-poster-scan",
  Tool_AmazonPosterLookup = "tool:amazon-poster-lookup",
  Tool_AmazonPosterApply = "tool:amazon-poster-apply",
  Tool_BatchTranslateScan = "tool:batch-translate-scan",
  Tool_BatchTranslateApply = "tool:batch-translate-apply",
  Tool_ToggleDevTools = "tool:toggle-devtools",

  Maintenance_StartPreview = "maintenance:start-preview",
  Maintenance_Apply = "maintenance:apply",
  Maintenance_Stop = "maintenance:stop",
  Maintenance_Pause = "maintenance:pause",
  Maintenance_Resume = "maintenance:resume",
  Maintenance_ReadSnapshot = "maintenance:read-snapshot",
  Maintenance_UpdateDraft = "maintenance:update-draft",
  Maintenance_DiscardSession = "maintenance:discard-session",
}

const IPC_CHANNEL_SET = new Set<string>(Object.values(IpcChannel));

export const isIpcChannel = (channel: string): channel is IpcChannel => IPC_CHANNEL_SET.has(channel);

export const requireIpcChannel = (channel: string): IpcChannel => {
  if (!isIpcChannel(channel)) {
    throw new Error(`Unsupported IPC channel: ${channel}`);
  }
  return channel;
};
