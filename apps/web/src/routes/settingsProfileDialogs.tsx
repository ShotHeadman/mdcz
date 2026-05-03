import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mdcz/ui";
import { cn } from "../lib/utils";
import type { ImportMode } from "./settingsController";

const PROFILE_DIALOG_CONTENT_CLASS_NAME =
  "max-w-xl gap-6 rounded-[var(--radius-quiet-xl)] border border-border/40 bg-surface-floating p-7 shadow-[0_32px_90px_-40px_rgba(15,23,42,0.45)]";
const PROFILE_DIALOG_INPUT_CLASS_NAME =
  "h-11 rounded-[var(--radius-quiet)] border-border/40 bg-surface-low px-4 shadow-none";
const PROFILE_DIALOG_SELECT_TRIGGER_CLASS_NAME =
  "h-11 w-full rounded-[var(--radius-quiet)] border-border/40 bg-surface-low px-4 shadow-none";
const PROFILE_DIALOG_SECONDARY_BUTTON_CLASS_NAME =
  "rounded-[var(--radius-quiet-capsule)] border-border/40 bg-surface-low px-5";
const PROFILE_DIALOG_PRIMARY_BUTTON_CLASS_NAME = "rounded-[var(--radius-quiet-capsule)] px-5";

interface SettingsProfileDialogsProps {
  activeProfile: string | null;
  deletableProfiles: string[];
  deleteProfileDialogOpen: boolean;
  deleteProfileName: string;
  importDialogOpen: boolean;
  importFileLabel: string;
  importFilePath: string;
  importMode: ImportMode;
  importProfileName: string;
  importTargetName: string;
  newProfileDialogOpen: boolean;
  newProfileName: string;
  overwriteProfileName: string;
  profiles: string[];
  resetDialogOpen: boolean;
  onBrowseImportFile: () => void;
  onCreateProfile: () => void;
  onDeleteProfile: () => void;
  onDeleteProfileDialogOpenChange: (open: boolean) => void;
  onDeleteProfileNameChange: (name: string) => void;
  onImportDialogOpenChange: (open: boolean) => void;
  onImportModeChange: (mode: ImportMode) => void;
  onImportProfile: () => void;
  onImportProfileNameChange: (name: string) => void;
  onNewProfileDialogOpenChange: (open: boolean) => void;
  onNewProfileNameChange: (name: string) => void;
  onOverwriteProfileNameChange: (name: string) => void;
  onReset: () => void;
  onResetDialogOpenChange: (open: boolean) => void;
}

export function SettingsProfileDialogs(props: SettingsProfileDialogsProps) {
  return (
    <>
      <Dialog open={props.resetDialogOpen} onOpenChange={props.onResetDialogOpenChange}>
        <DialogContent className={PROFILE_DIALOG_CONTENT_CLASS_NAME}>
          <DialogHeader className="gap-3 text-left">
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">当前档案</p>
            <DialogTitle className="text-2xl font-semibold tracking-tight">恢复默认设置</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              这会将 <span className="font-medium text-foreground">{props.activeProfile ?? "default"}</span>{" "}
              重置为默认配置。 此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline" className={PROFILE_DIALOG_SECONDARY_BUTTON_CLASS_NAME}>
                取消
              </Button>
            </DialogClose>
            <Button variant="destructive" className={PROFILE_DIALOG_PRIMARY_BUTTON_CLASS_NAME} onClick={props.onReset}>
              确定恢复
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={props.newProfileDialogOpen} onOpenChange={props.onNewProfileDialogOpenChange}>
        <DialogContent className={PROFILE_DIALOG_CONTENT_CLASS_NAME}>
          <DialogHeader className="gap-3 text-left">
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">配置档案</p>
            <DialogTitle className="text-2xl font-semibold tracking-tight">新建配置档案</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              输入一个名称，将基于默认设置生成新的配置档案。
            </DialogDescription>
          </DialogHeader>
          <Input
            value={props.newProfileName}
            onChange={(event) => props.onNewProfileNameChange(event.target.value)}
            placeholder="配置档案名称"
            className={PROFILE_DIALOG_INPUT_CLASS_NAME}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                props.onCreateProfile();
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
              onClick={props.onCreateProfile}
              disabled={!props.newProfileName.trim()}
            >
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={props.deleteProfileDialogOpen} onOpenChange={props.onDeleteProfileDialogOpenChange}>
        <DialogContent className={PROFILE_DIALOG_CONTENT_CLASS_NAME}>
          <DialogHeader className="gap-3 text-left">
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">配置档案</p>
            <DialogTitle className="text-2xl font-semibold tracking-tight">删除配置档案</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              仅可删除非当前活动档案。删除后，该档案的设置文件将被移除。
            </DialogDescription>
          </DialogHeader>
          <Select value={props.deleteProfileName} onValueChange={props.onDeleteProfileNameChange}>
            <SelectTrigger className={PROFILE_DIALOG_SELECT_TRIGGER_CLASS_NAME}>
              <SelectValue placeholder="选择配置档案" />
            </SelectTrigger>
            <SelectContent>
              {props.deletableProfiles.map((profile) => (
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
              onClick={props.onDeleteProfile}
              disabled={!props.deleteProfileName}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={props.importDialogOpen} onOpenChange={props.onImportDialogOpenChange}>
        <DialogContent className={PROFILE_DIALOG_CONTENT_CLASS_NAME}>
          <DialogHeader className="gap-3 text-left">
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">配置档案</p>
            <DialogTitle className="text-2xl font-semibold tracking-tight">导入配置档案</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              选择一个导出的设置文件（TOML 或 JSON），并决定导入为新档案或覆盖现有档案。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">源文件</div>
              <div className="flex gap-2">
                <Input
                  value={props.importFileLabel}
                  readOnly
                  placeholder="选择一个 TOML/JSON 文件"
                  className={cn(PROFILE_DIALOG_INPUT_CLASS_NAME, "font-mono text-xs")}
                />
                <Button
                  type="button"
                  variant="outline"
                  className={PROFILE_DIALOG_SECONDARY_BUTTON_CLASS_NAME}
                  onClick={props.onBrowseImportFile}
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
                  onClick={() => props.onImportModeChange("new")}
                  className={cn(
                    "rounded-[var(--radius-quiet-sm)] px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
                    props.importMode === "new"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  新建档案
                </button>
                <button
                  type="button"
                  onClick={() => props.onImportModeChange("overwrite")}
                  className={cn(
                    "rounded-[var(--radius-quiet-sm)] px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
                    props.importMode === "overwrite"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  覆盖现有档案
                </button>
              </div>
            </div>

            {props.importMode === "new" ? (
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">档案名称</div>
                <Input
                  value={props.importProfileName}
                  onChange={(event) => props.onImportProfileNameChange(event.target.value)}
                  placeholder="为导入档案命名"
                  className={PROFILE_DIALOG_INPUT_CLASS_NAME}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      props.onImportProfile();
                    }
                  }}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">覆盖目标</div>
                <Select value={props.overwriteProfileName} onValueChange={props.onOverwriteProfileNameChange}>
                  <SelectTrigger className={PROFILE_DIALOG_SELECT_TRIGGER_CLASS_NAME}>
                    <SelectValue placeholder="选择要覆盖的档案" />
                  </SelectTrigger>
                  <SelectContent>
                    {props.profiles.map((profile) => (
                      <SelectItem key={profile} value={profile}>
                        {profile}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {props.overwriteProfileName === props.activeProfile && (
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
              onClick={props.onImportProfile}
              disabled={!props.importFilePath || !props.importTargetName}
            >
              导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
