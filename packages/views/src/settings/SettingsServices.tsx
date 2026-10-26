import type { Configuration } from "@mdcz/shared/config";
import type { Website } from "@mdcz/shared/enums";
import type {
  ApiKeyDto,
  IntegrationStatusResponse,
  NetworkCheckCookiesResponse,
  SiteConnectivityProbeResponse,
  TranslateTestInputDto,
  TranslateTestResponse,
} from "@mdcz/shared/serverDtos";
import type { SiteHealth } from "@mdcz/shared/siteResults";
import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react";
import type { PathAutocompleteResult } from "../path";

export interface SettingsBrowseFilter {
  name: string;
  extensions: string[];
}

export interface SettingsCrawlerSiteInfo {
  site: Website;
  name: string;
  enabled: boolean;
  native: boolean;
  health?: SiteHealth;
}

export interface SettingsWatermarkDirectoryInfo {
  path: string;
  warnings?: string[];
}

export interface SettingsWatermarkDirectoryOpenResult {
  copied?: boolean;
  message?: string;
  path?: string;
  unsupported?: boolean;
}

export type SettingsTranslateTestInput = TranslateTestInputDto;

/** Server only: API keys that downloaders and cloud drives use to reach the automation endpoints. */
export interface SettingsIntegrationServices {
  /** The origin downloaders reach this server at, as the browser sees it. */
  origin: string;
  listApiKeys: () => Promise<ApiKeyDto[]>;
  /** Returns the new key's secret, shown once. */
  createApiKey: (name: string) => Promise<string>;
  revokeApiKey: (id: string) => Promise<void>;
  /** Sends a message through each enabled channel using the settings as edited, saved or not. */
  testNotification: (settings: Configuration["notifications"]) => Promise<void>;
  status: () => Promise<IntegrationStatusResponse>;
}

export interface SettingsServices {
  /** A native picker; only the desktop app has one. */
  browsePath?: (kind: "file" | "directory", filters?: SettingsBrowseFilter[]) => Promise<string | null>;
  integrations?: SettingsIntegrationServices;
  /** Desktop shows its window and shortcut settings, the server its automation. */
  settingsTarget: "desktop" | "server";
  suggestDirectoryPath?: (path: string) => Promise<PathAutocompleteResult>;
  watermarkDirectoryActionLabel?: string;
  checkCookies: () => Promise<NetworkCheckCookiesResponse>;
  ensureWatermarkDirectory: () => Promise<SettingsWatermarkDirectoryInfo>;
  getInFlightSaves: () => number;
  subscribeInFlightSaves?: (listener: () => void) => () => void;
  incrementInFlightSaves: () => void;
  decrementInFlightSaves: () => void;
  listCrawlerSites: () => Promise<{ sites: SettingsCrawlerSiteInfo[] }>;
  openWatermarkDirectory: () => Promise<SettingsWatermarkDirectoryOpenResult | undefined>;
  probeSiteConnectivity: (site: Website) => Promise<SiteConnectivityProbeResponse>;
  relaunchApp: () => Promise<void>;
  resetConfig: (path?: string) => Promise<unknown>;
  saveConfig: (config?: Partial<Configuration>) => Promise<unknown>;
  testTranslation: (input: SettingsTranslateTestInput) => Promise<TranslateTestResponse>;
  updateCurrentConfigCache?: (flatPayload: Record<string, unknown>) => void;
}

const SettingsServicesContext = createContext<SettingsServices | null>(null);

export function SettingsServicesProvider({ children, services }: { children?: ReactNode; services: SettingsServices }) {
  return <SettingsServicesContext.Provider value={services}>{children}</SettingsServicesContext.Provider>;
}

export function useSettingsServices(): SettingsServices {
  const services = useContext(SettingsServicesContext);
  if (!services) {
    throw new Error("Settings views must be wrapped in <SettingsServicesProvider>");
  }
  return services;
}

export function useSettingsInFlightSaves(): number {
  const services = useSettingsServices();
  return useSyncExternalStore(
    services.subscribeInFlightSaves ?? (() => () => undefined),
    services.getInFlightSaves,
    services.getInFlightSaves,
  );
}
