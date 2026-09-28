import {
  Button,
  cn,
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
import { useT } from "../i18n";

export type SettingsProfileImportMode = "new" | "overwrite";

interface SettingsProfileDialogsProps {
  activeProfile: string | null;
  deletableProfiles: string[];
  deleteProfileDialogOpen: boolean;
  deleteProfileName: string;
  importDialogOpen: boolean;
  importFileLabel: string;
  importFilePath: string;
  importMode: SettingsProfileImportMode;
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
  onImportModeChange: (mode: SettingsProfileImportMode) => void;
  onImportProfile: () => void;
  onImportProfileNameChange: (name: string) => void;
  onNewProfileDialogOpenChange: (open: boolean) => void;
  onNewProfileNameChange: (name: string) => void;
  onOverwriteProfileNameChange: (name: string) => void;
  onReset: () => void;
  onResetDialogOpenChange: (open: boolean) => void;
}

const PROFILE_DIALOG_CONTENT_CLASS_NAME =
  "max-w-xl gap-6 rounded-[var(--radius-quiet-xl)] border border-border/40 bg-surface-floating p-7 shadow-[0_32px_90px_-40px_rgba(15,23,42,0.45)]";
const PROFILE_DIALOG_INPUT_CLASS_NAME =
  "h-11 rounded-[var(--radius-quiet)] border-border/40 bg-surface-low px-4 shadow-none";
const PROFILE_DIALOG_SELECT_TRIGGER_CLASS_NAME =
  "h-11 w-full rounded-[var(--radius-quiet)] border-border/40 bg-surface-low px-4 shadow-none";
const PROFILE_DIALOG_SECONDARY_BUTTON_CLASS_NAME =
  "rounded-[var(--radius-quiet-capsule)] border-border/40 bg-surface-low px-5";
const PROFILE_DIALOG_PRIMARY_BUTTON_CLASS_NAME = "rounded-[var(--radius-quiet-capsule)] px-5";

export function SettingsProfileDialogs(props: SettingsProfileDialogsProps) {
  const t = useT();
  const text = t.settings.profiles;

  return (
    <>
      <Dialog open={props.resetDialogOpen} onOpenChange={props.onResetDialogOpenChange}>
        <DialogContent className={PROFILE_DIALOG_CONTENT_CLASS_NAME}>
          <DialogHeader className="gap-3 text-left">
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              {text.currentProfile}
            </p>
            <DialogTitle className="text-2xl font-semibold tracking-tight">{text.resetDefaults}</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              {text.resetDescriptionLead}
              <span className="font-medium text-foreground">{props.activeProfile ?? "default"}</span>
              {text.resetDescriptionTail}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline" className={PROFILE_DIALOG_SECONDARY_BUTTON_CLASS_NAME}>
                {t.common.cancel}
              </Button>
            </DialogClose>
            <Button variant="destructive" className={PROFILE_DIALOG_PRIMARY_BUTTON_CLASS_NAME} onClick={props.onReset}>
              {text.confirmReset}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={props.newProfileDialogOpen} onOpenChange={props.onNewProfileDialogOpenChange}>
        <DialogContent className={PROFILE_DIALOG_CONTENT_CLASS_NAME}>
          <DialogHeader className="gap-3 text-left">
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              {text.menuTitle}
            </p>
            <DialogTitle className="text-2xl font-semibold tracking-tight">{text.create}</DialogTitle>
            <DialogDescription className="text-sm leading-6">{text.createDescription}</DialogDescription>
          </DialogHeader>
          <Input
            value={props.newProfileName}
            onChange={(event) => props.onNewProfileNameChange(event.target.value)}
            placeholder={text.namePlaceholder}
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
                {t.common.cancel}
              </Button>
            </DialogClose>
            <Button
              className={PROFILE_DIALOG_PRIMARY_BUTTON_CLASS_NAME}
              onClick={props.onCreateProfile}
              disabled={!props.newProfileName.trim()}
            >
              {text.createAction}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={props.deleteProfileDialogOpen} onOpenChange={props.onDeleteProfileDialogOpenChange}>
        <DialogContent className={PROFILE_DIALOG_CONTENT_CLASS_NAME}>
          <DialogHeader className="gap-3 text-left">
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              {text.menuTitle}
            </p>
            <DialogTitle className="text-2xl font-semibold tracking-tight">{text.deleteTitle}</DialogTitle>
            <DialogDescription className="text-sm leading-6">{text.deleteDescription}</DialogDescription>
          </DialogHeader>
          <Select value={props.deleteProfileName} onValueChange={props.onDeleteProfileNameChange}>
            <SelectTrigger className={PROFILE_DIALOG_SELECT_TRIGGER_CLASS_NAME}>
              <SelectValue placeholder={text.selectProfile} />
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
                {t.common.cancel}
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              className={PROFILE_DIALOG_PRIMARY_BUTTON_CLASS_NAME}
              onClick={props.onDeleteProfile}
              disabled={!props.deleteProfileName}
            >
              {t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={props.importDialogOpen} onOpenChange={props.onImportDialogOpenChange}>
        <DialogContent className={PROFILE_DIALOG_CONTENT_CLASS_NAME}>
          <DialogHeader className="gap-3 text-left">
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              {text.menuTitle}
            </p>
            <DialogTitle className="text-2xl font-semibold tracking-tight">{text.importTitle}</DialogTitle>
            <DialogDescription className="text-sm leading-6">{text.importDescription}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {text.sourceFile}
              </div>
              <div className="flex gap-2">
                <Input
                  value={props.importFileLabel}
                  readOnly
                  placeholder={text.importFilePlaceholder}
                  className={cn(PROFILE_DIALOG_INPUT_CLASS_NAME, "font-mono text-xs")}
                />
                <Button
                  type="button"
                  variant="outline"
                  className={PROFILE_DIALOG_SECONDARY_BUTTON_CLASS_NAME}
                  onClick={props.onBrowseImportFile}
                >
                  {text.chooseFile}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {text.importMode}
              </div>
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
                  {text.importAsNew}
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
                  {text.importOverwrite}
                </button>
              </div>
            </div>

            {props.importMode === "new" ? (
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  {text.profileName}
                </div>
                <Input
                  value={props.importProfileName}
                  onChange={(event) => props.onImportProfileNameChange(event.target.value)}
                  placeholder={text.importNamePlaceholder}
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
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  {text.overwriteTarget}
                </div>
                <Select value={props.overwriteProfileName} onValueChange={props.onOverwriteProfileNameChange}>
                  <SelectTrigger className={PROFILE_DIALOG_SELECT_TRIGGER_CLASS_NAME}>
                    <SelectValue placeholder={text.selectOverwriteTarget} />
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
                  <p className="text-xs leading-5 text-muted-foreground">{text.activeProfileRefreshHint}</p>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline" className={PROFILE_DIALOG_SECONDARY_BUTTON_CLASS_NAME}>
                {t.common.cancel}
              </Button>
            </DialogClose>
            <Button
              className={PROFILE_DIALOG_PRIMARY_BUTTON_CLASS_NAME}
              onClick={props.onImportProfile}
              disabled={!props.importFilePath || !props.importTargetName}
            >
              {text.importAction}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
