import { toErrorMessage } from "@shared/error";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ipc } from "@/client/ipc";
import { SettingsEditor } from "@/components/settings/SettingsEditor";
import { SettingsLayout } from "@/components/settings/SettingsLayout";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select";
import { useConfigProfiles } from "@/hooks/useConfigProfiles";
import { useCurrentConfig } from "@/hooks/useCurrentConfig";
import { useDefaultConfig } from "@/hooks/useDefaultConfig";
import { cn } from "@/lib/utils";
import { useSettingsSavingStore } from "@/store/settingsSavingStore";

export const Route = createFileRoute("/settings")({
  validateSearch: (search): { setting?: string } => ({
    setting: typeof search.setting === "string" && search.setting.trim().length > 0 ? search.setting.trim() : undefined,
  }),
  component: SettingsComponent,
});

const PROFILE_IMPORT_FILTERS: Array<{ name: string; extensions: string[] }> = [{ name: "JSON", extensions: ["json"] }];
const PROFILE_DIALOG_CONTENT_CLASS_NAME =
  "max-w-xl gap-6 rounded-[var(--radius-quiet-xl)] border border-border/40 bg-surface-floating p-7 shadow-[0_32px_90px_-40px_rgba(15,23,42,0.45)]";
const PROFILE_DIALOG_INPUT_CLASS_NAME =
  "h-11 rounded-[var(--radius-quiet)] border-border/40 bg-surface-low px-4 shadow-none";
const PROFILE_DIALOG_SELECT_TRIGGER_CLASS_NAME =
  "h-11 w-full rounded-[var(--radius-quiet)] border-border/40 bg-surface-low px-4 shadow-none";
const PROFILE_DIALOG_SECONDARY_BUTTON_CLASS_NAME =
  "rounded-[var(--radius-quiet-capsule)] border-border/40 bg-surface-low px-5";
const PROFILE_DIALOG_PRIMARY_BUTTON_CLASS_NAME = "rounded-[var(--radius-quiet-capsule)] px-5";

type ImportMode = "new" | "overwrite";

function SettingsComponent() {
  const search = Route.useSearch();
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
      toast.warning(`有配置正在自动保存，请稍候再${actionLabel}`);
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
      invalidateConfigQueries();
      toast.success(`已恢复档案 "${activeProfile ?? "default"}" 的默认设置`);
      setResetDialogOpen(false);
    } catch (error) {
      toast.error(`重置失败: ${toErrorMessage(error)}`);
    }
  };

  const handleCreateProfile = async () => {
    const name = newProfileName.trim();
    if (!name) return;
    try {
      await ipc.config.createProfile(name);
      invalidateConfigQueries();
      toast.success(`配置档案 "${name}" 已创建`);
      setNewProfileName("");
      setNewProfileDialogOpen(false);
    } catch (error) {
      toast.error(`创建失败: ${toErrorMessage(error)}`);
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
      invalidateConfigQueries();
      toast.success(`已切换到配置档案 "${name}"`);
    } catch (error) {
      toast.error(`切换失败: ${toErrorMessage(error)}`);
    }
  };

  const handleDeleteProfile = async () => {
    if (!deleteProfileName) return;
    try {
      await ipc.config.deleteProfile(deleteProfileName);
      invalidateConfigQueries();
      toast.success("配置档案已删除");
      setDeleteProfileDialogOpen(false);
      setDeleteProfileName("");
    } catch (error) {
      toast.error(`删除失败: ${toErrorMessage(error)}`);
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
      toast.error(`导出失败: ${toErrorMessage(error)}`);
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
      toast.error(`选择文件失败: ${toErrorMessage(error)}`);
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
      invalidateConfigQueries();
      toast.success(
        result.overwritten ? `配置档案 "${result.profileName}" 已覆盖导入` : `配置档案 "${result.profileName}" 已导入`,
      );
      setImportDialogOpen(false);
      resetImportState();
    } catch (error) {
      toast.error(`导入失败: ${toErrorMessage(error)}`);
    }
  };

  if (configQ.isError) {
    return <div className="p-4 text-destructive">Error loading settings.</div>;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-hidden">
        {configQ.data ? (
          <SettingsEditor
            key={activeProfile ?? "default"}
            data={configQ.data}
            defaultConfig={defaultsQ.data}
            defaultConfigReady={Boolean(defaultsQ.data)}
            deepLinkSettingKey={search.setting ?? null}
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

      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent className={PROFILE_DIALOG_CONTENT_CLASS_NAME}>
          <DialogHeader className="gap-3 text-left">
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">当前档案</p>
            <DialogTitle className="text-2xl font-semibold tracking-tight">恢复默认设置</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              这会将 <span className="font-medium text-foreground">{activeProfile ?? "default"}</span> 重置为默认配置。
              此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline" className={PROFILE_DIALOG_SECONDARY_BUTTON_CLASS_NAME}>
                取消
              </Button>
            </DialogClose>
            <Button variant="destructive" className={PROFILE_DIALOG_PRIMARY_BUTTON_CLASS_NAME} onClick={handleReset}>
              确定恢复
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newProfileDialogOpen} onOpenChange={setNewProfileDialogOpen}>
        <DialogContent className={PROFILE_DIALOG_CONTENT_CLASS_NAME}>
          <DialogHeader className="gap-3 text-left">
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">配置档案</p>
            <DialogTitle className="text-2xl font-semibold tracking-tight">新建配置档案</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              输入一个名称，将基于默认设置生成新的配置档案。
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newProfileName}
            onChange={(event) => setNewProfileName(event.target.value)}
            placeholder="配置档案名称"
            className={PROFILE_DIALOG_INPUT_CLASS_NAME}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleCreateProfile();
              }
            }}
          />
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline" className={PROFILE_DIALOG_SECONDARY_BUTTON_CLASS_NAME}>
                取消
              </Button>
            </DialogClose>
            <Button
              className={PROFILE_DIALOG_PRIMARY_BUTTON_CLASS_NAME}
              onClick={handleCreateProfile}
              disabled={!newProfileName.trim()}
            >
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteProfileDialogOpen} onOpenChange={setDeleteProfileDialogOpen}>
        <DialogContent className={PROFILE_DIALOG_CONTENT_CLASS_NAME}>
          <DialogHeader className="gap-3 text-left">
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">配置档案</p>
            <DialogTitle className="text-2xl font-semibold tracking-tight">删除配置档案</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              仅可删除非当前活动档案。删除后，该档案的设置文件将被移除。
            </DialogDescription>
          </DialogHeader>
          <Select value={deleteProfileName} onValueChange={setDeleteProfileName}>
            <SelectTrigger className={PROFILE_DIALOG_SELECT_TRIGGER_CLASS_NAME}>
              <SelectValue placeholder="选择配置档案" />
            </SelectTrigger>
            <SelectContent>
              {deletableProfiles.map((profile) => (
                <SelectItem key={profile} value={profile}>
                  {profile}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline" className={PROFILE_DIALOG_SECONDARY_BUTTON_CLASS_NAME}>
                取消
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              className={PROFILE_DIALOG_PRIMARY_BUTTON_CLASS_NAME}
              onClick={handleDeleteProfile}
              disabled={!deleteProfileName}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importDialogOpen}
        onOpenChange={(open) => {
          setImportDialogOpen(open);
          if (!open) {
            resetImportState();
          }
        }}
      >
        <DialogContent className={PROFILE_DIALOG_CONTENT_CLASS_NAME}>
          <DialogHeader className="gap-3 text-left">
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">配置档案</p>
            <DialogTitle className="text-2xl font-semibold tracking-tight">导入 JSON 档案</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              选择一个导出的设置文件，并决定导入为新档案，或覆盖现有档案。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">源文件</div>
              <div className="flex gap-2">
                <Input
                  value={importFilePath}
                  readOnly
                  placeholder="选择一个 JSON 文件"
                  className={cn(PROFILE_DIALOG_INPUT_CLASS_NAME, "font-mono text-xs")}
                />
                <Button
                  type="button"
                  variant="outline"
                  className={PROFILE_DIALOG_SECONDARY_BUTTON_CLASS_NAME}
                  onClick={handleBrowseImportFile}
                >
                  选择文件
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">导入方式</div>
              <div className="grid grid-cols-2 gap-2 rounded-[var(--radius-quiet)] bg-surface-low/80 p-1">
                <button
                  type="button"
                  onClick={() => setImportMode("new")}
                  className={cn(
                    "rounded-[var(--radius-quiet-sm)] px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
                    importMode === "new"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  新建档案
                </button>
                <button
                  type="button"
                  onClick={() => setImportMode("overwrite")}
                  className={cn(
                    "rounded-[var(--radius-quiet-sm)] px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
                    importMode === "overwrite"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  覆盖现有档案
                </button>
              </div>
            </div>

            {importMode === "new" ? (
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">档案名称</div>
                <Input
                  value={importProfileName}
                  onChange={(event) => setImportProfileName(event.target.value)}
                  placeholder="为导入档案命名"
                  className={PROFILE_DIALOG_INPUT_CLASS_NAME}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      handleImportProfile();
                    }
                  }}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">覆盖目标</div>
                <Select value={overwriteProfileName} onValueChange={setOverwriteProfileName}>
                  <SelectTrigger className={PROFILE_DIALOG_SELECT_TRIGGER_CLASS_NAME}>
                    <SelectValue placeholder="选择要覆盖的档案" />
                  </SelectTrigger>
                  <SelectContent>
                    {profiles.map((profile) => (
                      <SelectItem key={profile} value={profile}>
                        {profile}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {overwriteProfileName === activeProfile && (
                  <p className="text-xs leading-5 text-muted-foreground">
                    当前活动档案会在导入完成后立即刷新为新内容。
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline" className={PROFILE_DIALOG_SECONDARY_BUTTON_CLASS_NAME}>
                取消
              </Button>
            </DialogClose>
            <Button
              className={PROFILE_DIALOG_PRIMARY_BUTTON_CLASS_NAME}
              onClick={handleImportProfile}
              disabled={!importFilePath || !importTargetName}
            >
              导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
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
