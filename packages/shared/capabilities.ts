import { IpcChannel } from "./IpcChannel";
import type { IpcRouterContract } from "./ipcContract";
import type { ServerApiContract } from "./serverApi";

type ServerCapabilityPath = {
  [Namespace in keyof ServerApiContract & string]: {
    [Operation in keyof ServerApiContract[Namespace] & string]: ServerApiContract[Namespace][Operation] extends (
      ...args: never
    ) => unknown
      ? `${Namespace}.${Operation}`
      : {
          [Nested in keyof ServerApiContract[Namespace][Operation] & string]: `${Namespace}.${Operation}.${Nested}`;
        }[keyof ServerApiContract[Namespace][Operation] & string];
  }[keyof ServerApiContract[Namespace] & string];
}[keyof ServerApiContract & string];

export type SharedCapabilityStatus = "aligned" | "adapted";

export const SHARED_CAPABILITY_CONTRACTS = {
  AppEnsureWatermarkDirectoryResponse: true,
  Configuration: true,
  ConfigPathInput: true,
  ConfigProfileNameInput: true,
  ConfigProfileNameResponse: true,
  ConfigUpdateInput: true,
  ConfigProfileListResponse: true,
  CrawlerListSitesResponse: true,
  CrawlerProbeSiteConnectivityInput: true,
  LibraryAvailabilityInput: true,
  LibraryAvailabilityResponse: true,
  LibraryDeleteInput: true,
  LibraryDetailInput: true,
  LibraryListInput: true,
  LibraryListResponse: true,
  NamingPreviewResponse: true,
  NetworkCheckCookiesResponse: true,
  SiteConnectivityProbeResponse: true,
  SuccessTrue: true,
  TranslateTestLlmInput: true,
  TranslateTestLlmResponse: true,
  void: true,
} as const;

export const SHARED_CAPABILITY_BEHAVIOR_FIXTURES = {
  "app-ensure-watermark-directory": {
    desktop: IpcChannel.App_EnsureWatermarkDirectory,
    server: "app.ensureWatermarkDirectory",
  },
  "config-defaults": { desktop: IpcChannel.Config_GetDefaults, server: "config.defaults" },
  "config-profiles-create": { desktop: IpcChannel.Config_CreateProfile, server: "config.profiles.create" },
  "config-profiles-delete": { desktop: IpcChannel.Config_DeleteProfile, server: "config.profiles.delete" },
  "config-preview-naming": { desktop: IpcChannel.Config_PreviewNaming, server: "config.previewNaming" },
  "config-profiles-list": { desktop: IpcChannel.Config_ListProfiles, server: "config.profiles.list" },
  "config-profiles-switch": { desktop: IpcChannel.Config_SwitchProfile, server: "config.profiles.switch" },
  "config-reset": { desktop: IpcChannel.Config_Reset, server: "config.reset" },
  "config-save": { desktop: IpcChannel.Config_Save, server: "config.save" },
  "crawler-connectivity-probe": {
    desktop: IpcChannel.Crawler_ProbeSiteConnectivity,
    server: "crawler.probeSiteConnectivity",
  },
  "crawler-list-sites": { desktop: IpcChannel.Crawler_ListSites, server: "crawler.listSites" },
  "library-availability": { desktop: IpcChannel.Library_Availability, server: "library.availability" },
  "library-delete": { desktop: IpcChannel.Library_Delete, server: "library.delete" },
  "library-list-pagination": { desktop: IpcChannel.Library_List, server: "library.list" },
  "network-cookie-readiness": { desktop: IpcChannel.Network_CheckCookies, server: "network.checkCookies" },
  "overview-remove-recent-acquisition": {
    desktop: IpcChannel.Overview_RemoveRecentAcquisition,
    server: "overview.removeRecentAcquisition",
  },
  "translate-test-llm": { desktop: IpcChannel.Translate_TestLlm, server: "translate.testLlm" },
} as const satisfies Record<string, { desktop: keyof IpcRouterContract; server: ServerCapabilityPath }>;

export interface SharedCapability {
  id: string;
  desktop: keyof IpcRouterContract;
  server: ServerCapabilityPath;
  status: SharedCapabilityStatus;
  inputContract: keyof typeof SHARED_CAPABILITY_CONTRACTS;
  outputContract: keyof typeof SHARED_CAPABILITY_CONTRACTS;
  behaviorFixture: keyof typeof SHARED_CAPABILITY_BEHAVIOR_FIXTURES;
}

export const SHARED_CAPABILITIES = [
  {
    id: "app.ensureWatermarkDirectory",
    desktop: IpcChannel.App_EnsureWatermarkDirectory,
    server: "app.ensureWatermarkDirectory",
    status: "aligned",
    inputContract: "void",
    outputContract: "AppEnsureWatermarkDirectoryResponse",
    behaviorFixture: "app-ensure-watermark-directory",
  },
  {
    id: "config.defaults",
    desktop: IpcChannel.Config_GetDefaults,
    server: "config.defaults",
    status: "aligned",
    inputContract: "void",
    outputContract: "Configuration",
    behaviorFixture: "config-defaults",
  },
  {
    id: "config.previewNaming",
    desktop: IpcChannel.Config_PreviewNaming,
    server: "config.previewNaming",
    status: "adapted",
    inputContract: "void",
    outputContract: "NamingPreviewResponse",
    behaviorFixture: "config-preview-naming",
  },
  {
    id: "config.profiles.create",
    desktop: IpcChannel.Config_CreateProfile,
    server: "config.profiles.create",
    status: "adapted",
    inputContract: "ConfigProfileNameInput",
    outputContract: "ConfigProfileNameResponse",
    behaviorFixture: "config-profiles-create",
  },
  {
    id: "config.profiles.delete",
    desktop: IpcChannel.Config_DeleteProfile,
    server: "config.profiles.delete",
    status: "adapted",
    inputContract: "ConfigProfileNameInput",
    outputContract: "ConfigProfileNameResponse",
    behaviorFixture: "config-profiles-delete",
  },
  {
    id: "config.profiles.list",
    desktop: IpcChannel.Config_ListProfiles,
    server: "config.profiles.list",
    status: "aligned",
    inputContract: "void",
    outputContract: "ConfigProfileListResponse",
    behaviorFixture: "config-profiles-list",
  },
  {
    id: "config.profiles.switch",
    desktop: IpcChannel.Config_SwitchProfile,
    server: "config.profiles.switch",
    status: "adapted",
    inputContract: "ConfigProfileNameInput",
    outputContract: "Configuration",
    behaviorFixture: "config-profiles-switch",
  },
  {
    id: "config.reset",
    desktop: IpcChannel.Config_Reset,
    server: "config.reset",
    status: "adapted",
    inputContract: "ConfigPathInput",
    outputContract: "Configuration",
    behaviorFixture: "config-reset",
  },
  {
    id: "config.save",
    desktop: IpcChannel.Config_Save,
    server: "config.save",
    status: "adapted",
    inputContract: "ConfigUpdateInput",
    outputContract: "Configuration",
    behaviorFixture: "config-save",
  },
  {
    id: "crawler.listSites",
    desktop: IpcChannel.Crawler_ListSites,
    server: "crawler.listSites",
    status: "aligned",
    inputContract: "void",
    outputContract: "CrawlerListSitesResponse",
    behaviorFixture: "crawler-list-sites",
  },
  {
    id: "crawler.probeSiteConnectivity",
    desktop: IpcChannel.Crawler_ProbeSiteConnectivity,
    server: "crawler.probeSiteConnectivity",
    status: "adapted",
    inputContract: "CrawlerProbeSiteConnectivityInput",
    outputContract: "SiteConnectivityProbeResponse",
    behaviorFixture: "crawler-connectivity-probe",
  },
  {
    id: "library.availability",
    desktop: IpcChannel.Library_Availability,
    server: "library.availability",
    status: "aligned",
    inputContract: "LibraryAvailabilityInput",
    outputContract: "LibraryAvailabilityResponse",
    behaviorFixture: "library-availability",
  },
  {
    id: "library.delete",
    desktop: IpcChannel.Library_Delete,
    server: "library.delete",
    status: "adapted",
    inputContract: "LibraryDeleteInput",
    outputContract: "SuccessTrue",
    behaviorFixture: "library-delete",
  },
  {
    id: "library.list",
    desktop: IpcChannel.Library_List,
    server: "library.list",
    status: "adapted",
    inputContract: "LibraryListInput",
    outputContract: "LibraryListResponse",
    behaviorFixture: "library-list-pagination",
  },
  {
    id: "network.checkCookies",
    desktop: IpcChannel.Network_CheckCookies,
    server: "network.checkCookies",
    status: "aligned",
    inputContract: "void",
    outputContract: "NetworkCheckCookiesResponse",
    behaviorFixture: "network-cookie-readiness",
  },
  {
    id: "overview.removeRecentAcquisition",
    desktop: IpcChannel.Overview_RemoveRecentAcquisition,
    server: "overview.removeRecentAcquisition",
    status: "aligned",
    inputContract: "LibraryDetailInput",
    outputContract: "SuccessTrue",
    behaviorFixture: "overview-remove-recent-acquisition",
  },
  {
    id: "translate.testLlm",
    desktop: IpcChannel.Translate_TestLlm,
    server: "translate.testLlm",
    status: "aligned",
    inputContract: "TranslateTestLlmInput",
    outputContract: "TranslateTestLlmResponse",
    behaviorFixture: "translate-test-llm",
  },
] as const satisfies readonly SharedCapability[];

export type { ServerCapabilityPath };
