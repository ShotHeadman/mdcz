import { toErrorMessage } from "@mdcz/shared/error";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useT } from "../i18n";
import { toConfigErrorMessage } from "./autoSaveUtils";
import { SettingsEditor } from "./SettingsEditor";
import { SettingsLayout } from "./SettingsLayout";
import { SettingsProfileDialogs, type SettingsProfileImportMode } from "./SettingsProfileDialogs";
import { type SettingsNotifier, type SettingsServices, SettingsServicesProvider } from "./SettingsServices";
import type { FieldAnchor } from "./settingsRegistry";

export interface SettingsProfileActions {
  reset: () => Promise<unknown>;
  create: (name: string) => Promise<unknown>;
  switch: (name: string) => Promise<unknown>;
  delete: (name: string) => Promise<unknown>;
  /** Resolves to null when the user cancels the save dialog. */
  export: (name: string) => Promise<{ profileName: string } | null>;
  /** Resolves to null when the user cancels the file picker. */
  pickImportFile: () => Promise<{ path: string; label: string } | null>;
  import: (input: {
    path: string;
    name: string;
    overwrite: boolean;
  }) => Promise<{ profileName: string; overwritten: boolean }>;
  invalidate: () => void;
}

interface SettingsPageProps {
  config: Record<string, unknown> | undefined;
  configError: Error | null;
  defaultConfig: Record<string, unknown> | undefined;
  profiles: { profiles: string[]; active: string } | undefined;
  profilesLoading: boolean;
  services: SettingsServices;
  profileActions: SettingsProfileActions;
  initialSection?: FieldAnchor;
}

const notifier: SettingsNotifier = { error: toast.error, info: toast.info, success: toast.success };

function suggestImportProfileName(fileLabel: string, existingProfiles: readonly string[]): string {
  const baseName = (fileLabel.split(/[\\/]+/u).at(-1) ?? "").replace(/\.(json|toml)$/iu, "");
  const normalized =
    baseName
      .trim()
      .replace(/[^\p{L}\p{N}_-]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || "imported-profile";

  let candidate = normalized;
  for (let index = 2; existingProfiles.includes(candidate); index += 1) {
    candidate = `${normalized}-${index}`;
  }
  return candidate;
}

export function SettingsPage({
  config,
  configError,
  defaultConfig,
  profiles: profilesData,
  profilesLoading,
  services,
  profileActions,
  initialSection,
}: SettingsPageProps) {
  const t = useT();
  const text = t.settings.profiles;
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileDialogOpen, setNewProfileDialogOpen] = useState(false);
  const [deleteProfileDialogOpen, setDeleteProfileDialogOpen] = useState(false);
  const [deleteProfileName, setDeleteProfileName] = useState("");
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importMode, setImportMode] = useState<SettingsProfileImportMode>("new");
  const [importFile, setImportFile] = useState<{ path: string; label: string } | null>(null);
  const [importProfileName, setImportProfileName] = useState("");
  const [overwriteProfileName, setOverwriteProfileName] = useState("");

  const profiles = profilesData?.profiles ?? [];
  const activeProfile = profilesData?.active ?? null;
  const deletableProfiles = useMemo(
    () => profiles.filter((profile) => profile !== activeProfile),
    [profiles, activeProfile],
  );
  const importTargetName = importMode === "overwrite" ? overwriteProfileName : importProfileName.trim();

  const resetImportState = () => {
    setImportMode("new");
    setImportFile(null);
    setImportProfileName("");
    setOverwriteProfileName(activeProfile ?? profiles[0] ?? "default");
  };

  useEffect(() => {
    if (deleteProfileDialogOpen && !deletableProfiles.includes(deleteProfileName)) {
      setDeleteProfileName(deletableProfiles[0] ?? "");
    }
  }, [deleteProfileDialogOpen, deleteProfileName, deletableProfiles]);

  useEffect(() => {
    if (importDialogOpen && importMode === "overwrite" && !profiles.includes(overwriteProfileName)) {
      setOverwriteProfileName(activeProfile ?? profiles[0] ?? "default");
    }
  }, [activeProfile, importDialogOpen, importMode, overwriteProfileName, profiles]);

  // Profile actions read or replace the whole config file, so a pending field auto-save would be lost or exported stale.
  const ensureNoPendingSave = (action: string) => {
    if (services.getInFlightSaves() === 0) return true;
    toast.warning(text.savingWait(action));
    return false;
  };

  const runProfileAction = async (failedLabel: string, action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      toast.error(`${failedLabel}: ${toConfigErrorMessage(error)}`);
    }
  };

  const handleOpenResetDialog = () => {
    if (ensureNoPendingSave(text.actions.reset)) setResetDialogOpen(true);
  };

  const handleReset = () => {
    if (!ensureNoPendingSave(text.actions.reset)) return;
    void runProfileAction(text.failed.reset, async () => {
      await profileActions.reset();
      profileActions.invalidate();
      toast.success(text.resetSucceeded(activeProfile ?? "default"));
      setResetDialogOpen(false);
    });
  };

  const handleCreateProfile = () => {
    const name = newProfileName.trim();
    if (!name) return;
    void runProfileAction(text.failed.create, async () => {
      await profileActions.create(name);
      profileActions.invalidate();
      toast.success(text.created(name));
      setNewProfileName("");
      setNewProfileDialogOpen(false);
    });
  };

  const handleSwitchProfile = (name: string) => {
    if (!name || name === activeProfile || !ensureNoPendingSave(text.actions.switch)) return;
    void runProfileAction(text.failed.switch, async () => {
      await profileActions.switch(name);
      profileActions.invalidate();
      toast.success(text.switched(name));
    });
  };

  const handleDeleteProfile = () => {
    if (!deleteProfileName) return;
    void runProfileAction(text.failed.delete, async () => {
      await profileActions.delete(deleteProfileName);
      profileActions.invalidate();
      toast.success(text.deleted);
      setDeleteProfileDialogOpen(false);
      setDeleteProfileName("");
    });
  };

  const handleExportProfile = () => {
    if (!activeProfile || !ensureNoPendingSave(text.actions.export)) return;
    void runProfileAction(text.failed.export, async () => {
      const result = await profileActions.export(activeProfile);
      if (result) toast.success(text.exported(result.profileName));
    });
  };

  const handleOpenImportDialog = () => {
    resetImportState();
    setImportDialogOpen(true);
  };

  const handleBrowseImportFile = async () => {
    try {
      const file = await profileActions.pickImportFile();
      if (!file) return;
      setImportFile(file);
      setImportProfileName(suggestImportProfileName(file.label, profiles));
    } catch (error) {
      toast.error(`${text.failed.selectFile}: ${toErrorMessage(error)}`);
    }
  };

  const handleImportProfile = () => {
    if (!importFile || !importTargetName || !ensureNoPendingSave(text.actions.import)) return;
    void runProfileAction(text.failed.import, async () => {
      const result = await profileActions.import({
        path: importFile.path,
        name: importTargetName,
        overwrite: importMode === "overwrite",
      });
      profileActions.invalidate();
      toast.success(result.overwritten ? text.overwritten(result.profileName) : text.imported(result.profileName));
      setImportDialogOpen(false);
      resetImportState();
    });
  };

  if (configError) {
    return <div className="p-4 text-destructive">{text.loadFailed(toErrorMessage(configError))}</div>;
  }

  const profileProps = {
    profiles,
    activeProfile,
    profileLoading: profilesLoading,
    onSwitchProfile: handleSwitchProfile,
    onCreateProfile: () => setNewProfileDialogOpen(true),
    onDeleteProfile: () => setDeleteProfileDialogOpen(true),
    onResetConfig: handleOpenResetDialog,
    onExportProfile: handleExportProfile,
    onImportProfile: handleOpenImportDialog,
  };

  return (
    <SettingsServicesProvider services={services} notifier={notifier}>
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex-1 overflow-hidden">
          {config ? (
            <SettingsEditor
              key={activeProfile ?? "default"}
              data={config}
              defaultConfig={defaultConfig}
              defaultConfigReady={Boolean(defaultConfig)}
              initialSection={initialSection}
              {...profileProps}
            />
          ) : (
            <SettingsLayout searchDisabled {...profileProps}>
              <SettingsSkeleton />
            </SettingsLayout>
          )}
        </div>

        <SettingsProfileDialogs
          activeProfile={activeProfile}
          deletableProfiles={deletableProfiles}
          deleteProfileDialogOpen={deleteProfileDialogOpen}
          deleteProfileName={deleteProfileName}
          importDialogOpen={importDialogOpen}
          importFileLabel={importFile?.label ?? ""}
          importFilePath={importFile?.path ?? ""}
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
            if (!open) resetImportState();
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

const SKELETON_SECTION_KEYS = ["section-a", "section-b", "section-c", "section-d"];
const SKELETON_ROW_KEYS = ["row-a", "row-b", "row-c", "row-d"];

function SettingsSkeleton() {
  return (
    <div className="space-y-10">
      {SKELETON_SECTION_KEYS.map((sectionKey) => (
        <section key={sectionKey} className="space-y-4">
          <div className="space-y-2">
            <div className="h-7 w-40 animate-pulse rounded-full bg-foreground/8" />
            <div className="h-4 w-72 animate-pulse rounded-full bg-foreground/6" />
          </div>
          <div className="space-y-3 rounded-[var(--radius-quiet-xl)] border border-border/30 bg-surface px-5 py-5">
            {SKELETON_ROW_KEYS.map((rowKey) => (
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
