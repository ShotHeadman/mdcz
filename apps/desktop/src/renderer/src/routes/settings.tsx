import {
  type FieldAnchor,
  isFieldAnchor,
  mergeConfigWithFlatPayload,
  SettingsPage,
  type SettingsProfileActions,
  type SettingsServices,
} from "@mdcz/views/settings";
import { useSettingsSavingStore } from "@mdcz/views/state/settingsSavingStore";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { ipc } from "@/client/ipc";
import { CURRENT_CONFIG_QUERY_KEY, useConfigProfiles, useCurrentConfig, useDefaultConfig } from "@/hooks/configQueries";

export const Route = createFileRoute("/settings")({
  validateSearch: (search): { section?: FieldAnchor } => ({
    section: isFieldAnchor(search.section) ? search.section : undefined,
  }),
  component: SettingsComponent,
});

const createSettingsServices = (queryClient: QueryClient): SettingsServices => ({
  browsePath: async (kind, filters) => {
    const result = await ipc.file.browse(kind, filters);
    return { ...result, paths: result.paths ?? undefined };
  },
  checkCookies: ipc.network.checkCookies,
  decrementInFlightSaves: useSettingsSavingStore.getState().decrementInFlight,
  ensureWatermarkDirectory: ipc.app.ensureWatermarkDirectory,
  getInFlightSaves: () => useSettingsSavingStore.getState().inFlight,
  incrementInFlightSaves: useSettingsSavingStore.getState().incrementInFlight,
  listCrawlerSites: async () => {
    const result = await ipc.crawler.listSites();
    return { sites: result.sites };
  },
  openWatermarkDirectory: async () => {
    await ipc.app.openWatermarkDirectory();
    return undefined;
  },
  probeSiteConnectivity: ipc.crawler.probeSiteConnectivity,
  relaunchApp: async () => {
    await ipc.app.relaunch();
  },
  resetConfig: ipc.config.reset,
  saveConfig: ipc.config.save,
  settingsTarget: "desktop",
  subscribeInFlightSaves: useSettingsSavingStore.subscribe,
  testTranslation: ipc.translate.testTranslation,
  updateCurrentConfigCache: (flatPayload: Record<string, unknown>) => {
    queryClient.setQueryData(CURRENT_CONFIG_QUERY_KEY, (previous) => {
      if (typeof previous !== "object" || previous === null || Array.isArray(previous)) {
        return previous;
      }
      return mergeConfigWithFlatPayload(previous as Record<string, unknown>, flatPayload);
    });
  },
});

const createProfileActions = (queryClient: QueryClient): SettingsProfileActions => ({
  reset: () => ipc.config.reset(),
  create: ipc.config.createProfile,
  switch: ipc.config.switchProfile,
  delete: ipc.config.deleteProfile,
  export: async (name) => {
    const result = await ipc.config.exportProfile(name);
    return result.canceled ? null : result;
  },
  pickImportFile: async () => {
    const result = await ipc.file.browse("file", [{ name: "TOML/JSON", extensions: ["toml", "json"] }]);
    const path = result.paths?.[0]?.trim();
    return path ? { path, label: path } : null;
  },
  import: ({ path, name, overwrite }) => ipc.config.importProfile(path, name, overwrite),
  invalidate: () => queryClient.invalidateQueries({ queryKey: ["config"] }),
});

function SettingsComponent() {
  const { section } = Route.useSearch();
  const queryClient = useQueryClient();
  const configQ = useCurrentConfig({ refetchOnWindowFocus: false });
  const defaultsQ = useDefaultConfig({ refetchOnWindowFocus: false });
  const profilesQ = useConfigProfiles({ refetchOnWindowFocus: false });
  const services = useMemo(() => createSettingsServices(queryClient), [queryClient]);
  const profileActions = useMemo(() => createProfileActions(queryClient), [queryClient]);

  return (
    <SettingsPage
      config={configQ.data}
      configError={configQ.error}
      defaultConfig={defaultsQ.data}
      profiles={profilesQ.data}
      profilesLoading={profilesQ.isLoading}
      services={services}
      profileActions={profileActions}
      initialSection={section}
    />
  );
}
