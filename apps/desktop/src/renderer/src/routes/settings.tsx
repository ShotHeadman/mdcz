import { toErrorMessage } from "@mdcz/shared/error";
import { useT } from "@mdcz/views/i18n";
import {
  mergeConfigWithFlatPayload,
  SettingsEditor,
  SettingsLayout,
  type SettingsNotifier,
  SettingsProfileDialogs,
  type SettingsServices,
  SettingsServicesProvider,
  toConfigErrorMessage,
} from "@mdcz/views/settings";
import { useSettingsSavingStore } from "@mdcz/views/state/settingsSavingStore";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ipc } from "@/client/ipc";
import { CURRENT_CONFIG_QUERY_KEY, useConfigProfiles, useCurrentConfig, useDefaultConfig } from "@/hooks/configQueries";

export const Route = createFileRoute("/settings")({
  component: SettingsComponent,
});

const PROFILE_IMPORT_FILTERS: Array<{ name: string; extensions: string[] }> = [
  { name: "TOML/JSON", extensions: ["toml", "json"] },
];

type ImportMode = "new" | "overwrite";

function SettingsComponent() {
  const t = useT();
  const queryClient = useQueryClient();
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileDialogOpen, setNewProfileDialogOpen] = useState(false);
  const [deleteProfileDialogOpen, setDeleteProfileDialogOpen] = useState(false);
  const [deleteProfileName, setDeleteProfileName] = useState("");
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>("new");
  const [importFilePath, setImportFilePath] = useState("");
  const [importProfileName, setImportProfileName] = useState("");
  const [overwriteProfileName, setOverwriteProfileName] = useState("");

  const configQ = useCurrentConfig({
    refetchOnWindowFocus: false,
  });

  const defaultsQ = useDefaultConfig({
    refetchOnWindowFocus: false,
  });

  const profilesQ = useConfigProfiles({
    refetchOnWindowFocus: false,
  });
  const settingsServices = useMemo(
    () =>
      ({
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
        previewNaming: ipc.config.previewNaming,
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
      }) satisfies SettingsServices,
    [queryClient],
  );
  const settingsNotifier = useMemo(
    () =>
      ({
        error: toast.error,
        info: toast.info,
        success: toast.success,
      }) satisfies SettingsNotifier,
    [],
  );

  const profiles = profilesQ.data?.profiles ?? [];
  const activeProfile = profilesQ.data?.active ?? null;

  const deletableProfiles = useMemo(
    () => profiles.filter((profile) => profile !== activeProfile),
    [profiles, activeProfile],
  );
  const importTargetName = importMode === "overwrite" ? overwriteProfileName : importProfileName.trim();

  const invalidateConfigQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["config"] });
    queryClient.invalidateQueries({ queryKey: ["config", "profiles"] });
    queryClient.invalidateQueries({ queryKey: ["config", "info"] });
  };

  const ensureProfileActionReady = (actionLabel: string) => {
    const inFlight = useSettingsSavingStore.getState().inFlight;
    if (inFlight > 0) {
      toast.warning(t.desktop.savingWaitMessage(actionLabel));
      return false;
    }
    return true;
  };

  const resetImportState = () => {
    setImportMode("new");
    setImportFilePath("");
    setImportProfileName("");
    setOverwriteProfileName(activeProfile ?? profiles[0] ?? "default");
  };

  useEffect(() => {
    if (!deleteProfileDialogOpen) {
      return;
    }
    if (!deleteProfileName || !deletableProfiles.includes(deleteProfileName)) {
      setDeleteProfileName(deletableProfiles[0] ?? "");
    }
  }, [deleteProfileDialogOpen, deleteProfileName, deletableProfiles]);

  useEffect(() => {
    if (!importDialogOpen || importMode !== "overwrite") {
      return;
    }
    if (!overwriteProfileName || !profiles.includes(overwriteProfileName)) {
      setOverwriteProfileName(activeProfile ?? profiles[0] ?? "default");
    }
  }, [activeProfile, importDialogOpen, importMode, overwriteProfileName, profiles]);

  const handleOpenResetDialog = () => {
    if (!ensureProfileActionReady(t.desktop.actionResetDefault)) {
      return;
    }
    setResetDialogOpen(true);
  };

  const handleReset = async () => {
    if (!ensureProfileActionReady(t.desktop.actionResetDefault)) {
      return;
    }
    try {
      await ipc.config.reset();
      invalidateConfigQueries();
      toast.success(t.desktop.profileResetSuccess(activeProfile ?? "default"));
      setResetDialogOpen(false);
    } catch (error) {
      toast.error(t.desktop.resetFailed(toConfigErrorMessage(error)));
    }
  };

  const handleCreateProfile = async () => {
    const name = newProfileName.trim();
    if (!name) return;
    try {
      await ipc.config.createProfile(name);
      invalidateConfigQueries();
      toast.success(t.desktop.profileCreated(name));
      setNewProfileName("");
      setNewProfileDialogOpen(false);
    } catch (error) {
      toast.error(t.desktop.createFailed(toErrorMessage(error)));
    }
  };

  const handleSwitchProfile = async (name: string) => {
    if (!name || name === activeProfile) {
      return;
    }
    if (!ensureProfileActionReady(t.desktop.actionSwitchProfile)) {
      return;
    }
    try {
      await ipc.config.switchProfile(name);
      invalidateConfigQueries();
      toast.success(t.desktop.profileSwitched(name));
    } catch (error) {
      toast.error(t.desktop.switchFailed(toConfigErrorMessage(error)));
    }
  };

  const handleDeleteProfile = async () => {
    if (!deleteProfileName) return;
    try {
      await ipc.config.deleteProfile(deleteProfileName);
      invalidateConfigQueries();
      toast.success(t.desktop.profileDeleted);
      setDeleteProfileDialogOpen(false);
      setDeleteProfileName("");
    } catch (error) {
      toast.error(t.desktop.deleteFailed(toErrorMessage(error)));
    }
  };

  const handleExportProfile = async () => {
    if (!activeProfile) {
      return;
    }
    if (!ensureProfileActionReady(t.desktop.actionExportProfile)) {
      return;
    }

    try {
      const result = await ipc.config.exportProfile(activeProfile);
      if (result.canceled) {
        return;
      }
      toast.success(t.desktop.profileExported(result.profileName));
    } catch (error) {
      toast.error(t.desktop.exportFailed(toConfigErrorMessage(error)));
    }
  };

  const handleOpenImportDialog = () => {
    resetImportState();
    setImportDialogOpen(true);
  };

  const handleBrowseImportFile = async () => {
    try {
      const result = await ipc.file.browse("file", [...PROFILE_IMPORT_FILTERS]);
      const filePath = result.paths?.[0]?.trim();
      if (!filePath) {
        return;
      }

      setImportFilePath(filePath);
      setImportProfileName(suggestImportProfileName(filePath, profiles));
    } catch (error) {
      toast.error(t.desktop.fileSelectFailed(toErrorMessage(error)));
    }
  };

  const handleImportProfile = async () => {
    if (!importFilePath || !importTargetName) {
      return;
    }
    if (!ensureProfileActionReady(t.desktop.actionImportProfile)) {
      return;
    }

    try {
      const result = await ipc.config.importProfile(importFilePath, importTargetName, importMode === "overwrite");
      invalidateConfigQueries();
      toast.success(
        result.overwritten
          ? t.desktop.profileOverwritten(result.profileName)
          : t.desktop.profileImported(result.profileName),
      );
      setImportDialogOpen(false);
      resetImportState();
    } catch (error) {
      toast.error(t.desktop.importFailed(toConfigErrorMessage(error)));
    }
  };

  if (configQ.isError) {
    return <div className="p-4 text-destructive">Error loading settings.</div>;
  }

  return (
    <SettingsServicesProvider services={settingsServices} notifier={settingsNotifier}>
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex-1 overflow-hidden">
          {configQ.data ? (
            <SettingsEditor
              key={activeProfile ?? "default"}
              data={configQ.data}
              defaultConfig={defaultsQ.data}
              defaultConfigReady={Boolean(defaultsQ.data)}
              profiles={profiles}
              activeProfile={activeProfile}
              profileLoading={profilesQ.isLoading}
              onSwitchProfile={handleSwitchProfile}
              onCreateProfile={() => setNewProfileDialogOpen(true)}
              onDeleteProfile={() => setDeleteProfileDialogOpen(true)}
              onResetConfig={handleOpenResetDialog}
              onExportProfile={handleExportProfile}
              onImportProfile={handleOpenImportDialog}
            />
          ) : (
            <SettingsLayout
              searchDisabled
              profiles={profiles}
              activeProfile={activeProfile}
              profileLoading={profilesQ.isLoading}
              onSwitchProfile={handleSwitchProfile}
              onCreateProfile={() => setNewProfileDialogOpen(true)}
              onDeleteProfile={() => setDeleteProfileDialogOpen(true)}
              onResetConfig={handleOpenResetDialog}
              onExportProfile={handleExportProfile}
              onImportProfile={handleOpenImportDialog}
            >
              <SettingsRouteSkeleton />
            </SettingsLayout>
          )}
        </div>

        <SettingsProfileDialogs
          activeProfile={activeProfile}
          deletableProfiles={deletableProfiles}
          deleteProfileDialogOpen={deleteProfileDialogOpen}
          deleteProfileName={deleteProfileName}
          importDialogOpen={importDialogOpen}
          importFileLabel={importFilePath}
          importFilePath={importFilePath}
          importMode={importMode}
          importProfileName={importProfileName}
          importTargetName={importTargetName}
          newProfileDialogOpen={newProfileDialogOpen}
          newProfileName={newProfileName}
          overwriteProfileName={overwriteProfileName}
          profiles={profiles}
          resetDialogOpen={resetDialogOpen}
          onBrowseImportFile={handleBrowseImportFile}
          onCreateProfile={handleCreateProfile}
          onDeleteProfile={handleDeleteProfile}
          onDeleteProfileDialogOpenChange={setDeleteProfileDialogOpen}
          onDeleteProfileNameChange={setDeleteProfileName}
          onImportDialogOpenChange={(open) => {
            setImportDialogOpen(open);
            if (!open) {
              resetImportState();
            }
          }}
          onImportModeChange={setImportMode}
          onImportProfile={handleImportProfile}
          onImportProfileNameChange={setImportProfileName}
          onNewProfileDialogOpenChange={setNewProfileDialogOpen}
          onNewProfileNameChange={setNewProfileName}
          onOverwriteProfileNameChange={setOverwriteProfileName}
          onReset={handleReset}
          onResetDialogOpenChange={setResetDialogOpen}
        />
      </div>
    </SettingsServicesProvider>
  );
}

function SettingsRouteSkeleton() {
  const sectionKeys = ["section-a", "section-b", "section-c", "section-d"];
  const rowKeys = ["row-a", "row-b", "row-c", "row-d"];

  return (
    <div className="space-y-10">
      {sectionKeys.map((sectionKey) => (
        <section key={sectionKey} className="space-y-4">
          <div className="space-y-2">
            <div className="h-7 w-40 animate-pulse rounded-full bg-foreground/8" />
            <div className="h-4 w-72 animate-pulse rounded-full bg-foreground/6" />
          </div>
          <div className="space-y-3 rounded-[var(--radius-quiet-xl)] border border-border/30 bg-surface px-5 py-5">
            {rowKeys.map((rowKey) => (
              <div
                key={`${sectionKey}-${rowKey}`}
                className="flex flex-col gap-2 py-2 md:flex-row md:items-center md:justify-between"
              >
                <div className="space-y-2">
                  <div className="h-4 w-36 animate-pulse rounded-full bg-foreground/8" />
                  <div className="h-3 w-56 animate-pulse rounded-full bg-foreground/6" />
                </div>
                <div className="h-8 w-48 animate-pulse rounded-[var(--radius-quiet)] bg-surface-low" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function suggestImportProfileName(filePath: string, existingProfiles: string[]): string {
  const fileName = filePath.split(/[\\/]+/u).at(-1) ?? "imported-profile";
  const baseName = fileName.replace(/\.json$/iu, "");
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
