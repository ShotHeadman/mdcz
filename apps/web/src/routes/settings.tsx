import { toErrorMessage } from "@mdcz/shared/error";
import { useT } from "@mdcz/views/i18n";
import {
  type FieldAnchor,
  isFieldAnchor,
  SettingsEditor,
  SettingsLayout,
  SettingsProfileDialogs,
  SettingsServicesProvider,
} from "@mdcz/views/settings";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { clearImportedFile, promptForImportFile, readImportedFile, triggerDownload } from "../browserFile";
import { api } from "../client";
import { useConfigProfiles, useCurrentConfig, useDefaultConfig } from "../hooks/configQueries";
import {
  createSettingsNotifier,
  createSettingsServices,
  ensureProfileActionReady,
  handleProfileActionError,
  type ImportMode,
  invalidateConfigQueries,
  PROFILE_IMPORT_FILTERS,
  suggestImportProfileName,
} from "./settingsController";

export const SettingsPage = () => {
  const t = useT();
  const { section } = Route.useSearch();
  const queryClient = useQueryClient();
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileDialogOpen, setNewProfileDialogOpen] = useState(false);
  const [deleteProfileDialogOpen, setDeleteProfileDialogOpen] = useState(false);
  const [deleteProfileName, setDeleteProfileName] = useState("");
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>("new");
  const [importFilePath, setImportFilePath] = useState("");
  const [importFileLabel, setImportFileLabel] = useState("");
  const [importProfileName, setImportProfileName] = useState("");
  const [overwriteProfileName, setOverwriteProfileName] = useState("");

  const configQ = useCurrentConfig();
  const defaultsQ = useDefaultConfig();
  const profilesQ = useConfigProfiles();
  const settingsServices = useMemo(() => createSettingsServices(queryClient), [queryClient]);
  const settingsNotifier = useMemo(() => createSettingsNotifier(), []);

  const profiles = profilesQ.data?.profiles ?? [];
  const activeProfile = profilesQ.data?.active ?? null;

  const deletableProfiles = useMemo(
    () => profiles.filter((profile) => profile !== activeProfile),
    [profiles, activeProfile],
  );
  const importTargetName = importMode === "overwrite" ? overwriteProfileName : importProfileName.trim();

  const resetImportState = () => {
    setImportMode("new");
    setImportFilePath("");
    setImportFileLabel("");
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
    if (!ensureProfileActionReady(t.web.actionResetDefault)) {
      return;
    }
    setResetDialogOpen(true);
  };

  const handleReset = async () => {
    if (!ensureProfileActionReady(t.web.actionResetDefault)) {
      return;
    }
    try {
      await api.config.reset();
      invalidateConfigQueries(queryClient);
      toast.success(t.web.profileResetSuccess(activeProfile ?? "default"));
      setResetDialogOpen(false);
    } catch (error) {
      handleProfileActionError(t.web.resetFailed, error);
    }
  };

  const handleCreateProfile = async () => {
    const name = newProfileName.trim();
    if (!name) return;
    try {
      await api.config.profiles.create({ name });
      invalidateConfigQueries(queryClient);
      toast.success(t.web.profileCreated(name));
      setNewProfileName("");
      setNewProfileDialogOpen(false);
    } catch (error) {
      handleProfileActionError(t.web.createFailed, error);
    }
  };

  const handleSwitchProfile = async (name: string) => {
    if (!name || name === activeProfile) {
      return;
    }
    if (!ensureProfileActionReady(t.web.actionSwitchProfile)) {
      return;
    }
    try {
      await api.config.profiles.switch({ name });
      invalidateConfigQueries(queryClient);
      toast.success(t.web.profileSwitched(name));
    } catch (error) {
      handleProfileActionError(t.web.switchFailed, error);
    }
  };

  const handleDeleteProfile = async () => {
    if (!deleteProfileName) return;
    try {
      await api.config.profiles.delete({ name: deleteProfileName });
      invalidateConfigQueries(queryClient);
      toast.success(t.web.profileDeleted);
      setDeleteProfileDialogOpen(false);
      setDeleteProfileName("");
    } catch (error) {
      handleProfileActionError(t.web.deleteFailed, error);
    }
  };

  const handleExportProfile = async () => {
    if (!activeProfile) {
      return;
    }
    if (!ensureProfileActionReady(t.web.actionExportProfile)) {
      return;
    }

    try {
      const result = await api.config.profiles.export({ name: activeProfile });
      triggerDownload(result.fileName, result.content, "application/toml;charset=utf-8");
      toast.success(t.web.profileExported(result.profileName));
    } catch (error) {
      handleProfileActionError(t.web.exportFailed, error);
    }
  };

  const handleOpenImportDialog = () => {
    resetImportState();
    setImportDialogOpen(true);
  };

  const handleBrowseImportFile = async () => {
    try {
      const result = await promptForImportFile([...PROFILE_IMPORT_FILTERS]);
      if (!result) {
        return;
      }

      setImportFilePath(result.path);
      setImportFileLabel(result.label);
      setImportProfileName(suggestImportProfileName(result.label, profiles));
    } catch (error) {
      handleProfileActionError(t.web.selectFileFailed, error);
    }
  };

  const handleImportProfile = async () => {
    if (!importFilePath || !importTargetName) {
      return;
    }
    if (!ensureProfileActionReady(t.web.actionImportProfile)) {
      return;
    }

    try {
      const file = await readImportedFile(importFilePath);
      const result = await api.config.profiles.import({
        name: importTargetName,
        content: file.content,
        fileName: file.fileName,
        overwrite: importMode === "overwrite",
      });
      clearImportedFile(importFilePath);
      invalidateConfigQueries(queryClient);
      toast.success(
        result.overwritten ? t.web.profileOverwritten(result.profileName) : t.web.profileImported(result.profileName),
      );
      setImportDialogOpen(false);
      resetImportState();
    } catch (error) {
      handleProfileActionError(t.web.importFailed, error);
    }
  };

  if (configQ.isError) {
    return <div className="p-4 text-destructive">{t.web.loadSettingsFailed(toErrorMessage(configQ.error))}</div>;
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
              initialSection={section}
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
          importFileLabel={importFileLabel}
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
};

export const Route = createFileRoute("/settings")({
  validateSearch: (search): { section?: FieldAnchor } => ({
    section: isFieldAnchor(search.section) ? search.section : undefined,
  }),
  component: SettingsPage,
});

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
