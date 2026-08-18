import { toErrorMessage } from "@mdcz/shared/error";
import {
  mergeConfigWithFlatPayload,
  type SettingsCrawlerSiteInfo,
  type SettingsNotifier,
  type SettingsServices,
} from "@mdcz/views/settings";
import { useSettingsSavingStore } from "@mdcz/views/state/settingsSavingStore";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../client";
import { CURRENT_CONFIG_QUERY_KEY } from "../hooks/configQueries";
import { queryKeys } from "../lib/queryKeys";

export const PROFILE_IMPORT_FILTERS: Array<{ name: string; extensions: string[] }> = [
  { name: "TOML/JSON", extensions: ["toml", "json"] },
];

export type ImportMode = "new" | "overwrite";

export const createSettingsServices = (queryClient: QueryClient): SettingsServices => ({
  browsePath: async () => ({ canceled: true, paths: [] }),
  checkCookies: async () => await api.network.checkCookies(),
  decrementInFlightSaves: useSettingsSavingStore.getState().decrementInFlight,
  ensureWatermarkDirectory: async () => await api.app.ensureWatermarkDirectory(),
  getInFlightSaves: () => useSettingsSavingStore.getState().inFlight,
  incrementInFlightSaves: useSettingsSavingStore.getState().incrementInFlight,
  listCrawlerSites: async () => {
    const result = await api.crawler.listSites();
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
  openWatermarkDirectory: async () => {
    const result = await api.app.ensureWatermarkDirectory();
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(result.path);
      return { copied: true, message: "已复制服务器角标图片目录路径。", path: result.path, unsupported: true };
    }
    return {
      copied: false,
      message: "浏览器无法打开服务器文件夹，请复制上方服务器路径。",
      path: result.path,
      unsupported: true,
    };
  },
  previewNaming: async (config) => await api.config.previewNaming(config ?? {}),
  probeSiteConnectivity: async (site) => await api.crawler.probeSiteConnectivity({ site }),
  relaunchApp: async () => window.location.reload(),
  resetConfig: async (path) => await api.config.reset(path ? { path } : undefined),
  saveConfig: async (config) => await api.config.update(config ?? {}),
  suggestDirectoryPath: async (path) => {
    const result = await api.serverPaths.suggest({ path, intent: "settings" });
    return {
      accessible: result.accessible,
      error: result.error,
      entries: result.entries.map((entry) => ({ label: entry.label, path: entry.path })),
    };
  },
  isServer: true,
  settingsTarget: "server",
  subscribeInFlightSaves: useSettingsSavingStore.subscribe,
  watermarkDirectoryActionLabel: "复制服务器路径",
  testLLM: async (input) => await api.translate.testLlm(input),
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
  queryClient.invalidateQueries({ queryKey: queryKeys.config.all });
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
