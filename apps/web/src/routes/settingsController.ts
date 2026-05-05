import { toErrorMessage } from "@mdcz/shared/error";
import { useSettingsSavingStore } from "@mdcz/shared/stores/settingsSavingStore";
import {
  mergeConfigWithFlatPayload,
  type SettingsCrawlerSiteInfo,
  type SettingsNotifier,
  type SettingsServices,
} from "@mdcz/views/settings";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../client";
import { ipc } from "../client/ipc";
import { CURRENT_CONFIG_QUERY_KEY } from "../hooks/configQueries";

export const PROFILE_IMPORT_FILTERS: Array<{ name: string; extensions: string[] }> = [
  { name: "TOML/JSON", extensions: ["toml", "json"] },
];

export type ImportMode = "new" | "overwrite";

export const createSettingsServices = (queryClient: QueryClient): SettingsServices => ({
  browsePath: async () => ({ canceled: true, paths: [] }),
  checkCookies: ipc.network.checkCookies,
  decrementInFlightSaves: useSettingsSavingStore.getState().decrementInFlight,
  ensureWatermarkDirectory: ipc.app.ensureWatermarkDirectory,
  getInFlightSaves: () => useSettingsSavingStore.getState().inFlight,
  incrementInFlightSaves: useSettingsSavingStore.getState().incrementInFlight,
  listCrawlerSites: async () => {
    const result = await ipc.crawler.listSites();
    return {
      sites: result.sites.filter(
        (site): site is SettingsCrawlerSiteInfo =>
          typeof site === "object" &&
          site !== null &&
          "site" in site &&
          "name" in site &&
          "enabled" in site &&
          "native" in site,
      ),
    };
  },
  openWatermarkDirectory: ipc.app.openWatermarkDirectory,
  previewNaming: ipc.config.previewNaming,
  probeSiteConnectivity: ipc.crawler.probeSiteConnectivity,
  relaunchApp: ipc.app.relaunch,
  resetConfig: ipc.config.reset,
  saveConfig: ipc.config.save,
  suggestDirectoryPath: async (path) => {
    const result = await api.serverPaths.suggest({ path, intent: "settings" });
    return {
      accessible: result.accessible,
      error: result.error,
      entries: result.entries.map((entry) => ({ label: entry.label, path: entry.path })),
    };
  },
  subscribeInFlightSaves: useSettingsSavingStore.subscribe,
  supportsPathBrowse: false,
  testLlm: ipc.translate.testLlm,
  updateCurrentConfigCache: (flatPayload: Record<string, unknown>) => {
    queryClient.setQueryData(CURRENT_CONFIG_QUERY_KEY, (previous) => {
      if (typeof previous !== "object" || previous === null || Array.isArray(previous)) {
        return previous;
      }
      return mergeConfigWithFlatPayload(previous as Record<string, unknown>, flatPayload);
    });
  },
});

export const createSettingsNotifier = (): SettingsNotifier => ({
  error: toast.error,
  info: toast.info,
  success: toast.success,
});

export const invalidateConfigQueries = (queryClient: QueryClient): void => {
  queryClient.invalidateQueries({ queryKey: ["config"] });
};

export const ensureProfileActionReady = (actionLabel: string): boolean => {
  const inFlight = useSettingsSavingStore.getState().inFlight;
  if (inFlight > 0) {
    toast.warning(`有配置正在自动保存，请稍候再${actionLabel}`);
    return false;
  }
  return true;
};

export const handleProfileActionError = (label: string, error: unknown): void => {
  toast.error(`${label}: ${toErrorMessage(error)}`);
};

export function suggestImportProfileName(fileName: string, existingProfiles: string[]): string {
  const baseName = fileName.replace(/\.(json|toml)$/iu, "");
  const normalized =
    baseName
      .trim()
      .replace(/[^\p{L}\p{N}_-]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || "imported-profile";

  if (!existingProfiles.includes(normalized)) {
    return normalized;
  }

  let index = 2;
  let candidate = `${normalized}-${index}`;
  while (existingProfiles.includes(candidate)) {
    index += 1;
    candidate = `${normalized}-${index}`;
  }
  return candidate;
}
