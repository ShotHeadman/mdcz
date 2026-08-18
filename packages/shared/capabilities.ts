import { IpcChannel } from "./IpcChannel";
import type { IpcRouterContract } from "./ipcContract";
import type { ServerApiContract } from "./serverApi";

type ServerCapabilityPath = {
  [Namespace in keyof ServerApiContract & string]: {
    [Operation in keyof ServerApiContract[Namespace] & string]: `${Namespace}.${Operation}`;
  }[keyof ServerApiContract[Namespace] & string];
}[keyof ServerApiContract & string];

export type SharedCapabilityStatus = "aligned" | "adapted";

export const SHARED_CAPABILITY_CONTRACTS = {
  Configuration: true,
  CrawlerProbeSiteConnectivityInput: true,
  LibraryAvailabilityInput: true,
  LibraryAvailabilityResponse: true,
  LibraryListInput: true,
  LibraryListResponse: true,
  NetworkCheckCookiesResponse: true,
  SiteConnectivityProbeResponse: true,
  void: true,
} as const;

export const SHARED_CAPABILITY_BEHAVIOR_FIXTURES = {
  "config-defaults": true,
  "crawler-connectivity-probe": true,
  "library-availability": true,
  "library-list-pagination": true,
  "network-cookie-readiness": true,
} as const;

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
    id: "config.defaults",
    desktop: IpcChannel.Config_GetDefaults,
    server: "config.defaults",
    status: "aligned",
    inputContract: "void",
    outputContract: "Configuration",
    behaviorFixture: "config-defaults",
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
    id: "network.checkCookies",
    desktop: IpcChannel.Network_CheckCookies,
    server: "network.checkCookies",
    status: "aligned",
    inputContract: "void",
    outputContract: "NetworkCheckCookiesResponse",
    behaviorFixture: "network-cookie-readiness",
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
    id: "library.availability",
    desktop: IpcChannel.Library_Availability,
    server: "library.availability",
    status: "aligned",
    inputContract: "LibraryAvailabilityInput",
    outputContract: "LibraryAvailabilityResponse",
    behaviorFixture: "library-availability",
  },
] as const satisfies readonly SharedCapability[];

export type { ServerCapabilityPath };
