import { toErrorMessage } from "@mdcz/shared/error";
import { SettingsEditor, SettingsLayout, SettingsServicesProvider } from "@mdcz/views/settings";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ipc } from "../client/ipc";
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
import { SettingsProfileDialogs } from "./settingsProfileDialogs";

export const SettingsPage = () => {
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
    if (!ensureProfileActionReady("恢复默认设置")) {
      return;
    }
    setResetDialogOpen(true);
  };

  const handleReset = async () => {
    if (!ensureProfileActionReady("恢复默认设置")) {
      return;
    }
    try {
      await ipc.config.reset();
      invalidateConfigQueries(queryClient);
      toast.success(`已恢复档案 "${activeProfile ?? "default"}" 的默认设置`);
      setResetDialogOpen(false);
    } catch (error) {
      handleProfileActionError("重置失败", error);
    }
  };

  const handleCreateProfile = async () => {
    const name = newProfileName.trim();
    if (!name) return;
    try {
      await ipc.config.createProfile(name);
      invalidateConfigQueries(queryClient);
      toast.success(`配置档案 "${name}" 已创建`);
      setNewProfileName("");
      setNewProfileDialogOpen(false);
    } catch (error) {
      handleProfileActionError("创建失败", error);
    }
  };

  const handleSwitchProfile = async (name: string) => {
    if (!name || name === activeProfile) {
      return;
    }
    if (!ensureProfileActionReady("切换档案")) {
      return;
    }
    try {
      await ipc.config.switchProfile(name);
      invalidateConfigQueries(queryClient);
      toast.success(`已切换到配置档案 "${name}"`);
    } catch (error) {
      handleProfileActionError("切换失败", error);
    }
  };

  const handleDeleteProfile = async () => {
    if (!deleteProfileName) return;
    try {
      await ipc.config.deleteProfile(deleteProfileName);
      invalidateConfigQueries(queryClient);
      toast.success("配置档案已删除");
      setDeleteProfileDialogOpen(false);
      setDeleteProfileName("");
    } catch (error) {
      handleProfileActionError("删除失败", error);
    }
  };

  const handleExportProfile = async () => {
    if (!activeProfile) {
      return;
    }
    if (!ensureProfileActionReady("导出配置档案")) {
      return;
    }

    try {
      const result = await ipc.config.exportProfile(activeProfile);
      if (result.canceled) {
        return;
      }
      toast.success(`配置档案 "${result.profileName}" 已导出`);
    } catch (error) {
      handleProfileActionError("导出失败", error);
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
      const fileName = filePath.split("/").at(-1) ?? filePath;
      setImportFileLabel(fileName);
      setImportProfileName(suggestImportProfileName(fileName, profiles));
    } catch (error) {
      handleProfileActionError("选择文件失败", error);
    }
  };

  const handleImportProfile = async () => {
    if (!importFilePath || !importTargetName) {
      return;
    }
    if (!ensureProfileActionReady("导入配置档案")) {
      return;
    }

    try {
      const result = await ipc.config.importProfile(importFilePath, importTargetName, importMode === "overwrite");
      invalidateConfigQueries(queryClient);
      toast.success(
        result.overwritten ? `配置档案 "${result.profileName}" 已覆盖导入` : `配置档案 "${result.profileName}" 已导入`,
      );
      setImportDialogOpen(false);
      resetImportState();
    } catch (error) {
      handleProfileActionError("导入失败", error);
    }
  };

  if (configQ.isError) {
    return <div className="p-4 text-destructive">加载设置失败：{toErrorMessage(configQ.error)}</div>;
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
              deepLinkSettingKey={null}
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
