import {
  AUTOMATION_LEVELS,
  DISCOVERY_MODES,
  type MediaLibraryDto,
  type MediaLibrarySettingsInput,
  mediaLibrarySettingsSchema,
  PLACEMENT_MODES,
} from "@mdcz/shared/mediaLibrary";
import type { NamingPreviewItem } from "@mdcz/shared/types";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mdcz/ui";
import { FolderOpen, Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { useT } from "../i18n";
import { PathAutocompleteInput, type PathAutocompleteResult } from "../path";
import { NamingTemplateHelp } from "../settings/settingsContent";

export interface LibraryEditorDialogProps {
  open: boolean;
  library?: MediaLibraryDto | null;
  /** A new library over a directory that already holds videos and NFOs: they stay where they are. */
  importExisting?: boolean;
  showAutomation: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (settings: MediaLibrarySettingsInput) => Promise<void>;
  onPreviewNaming: (settings: MediaLibrarySettingsInput) => Promise<NamingPreviewItem[]>;
  loadDirectorySuggestions?: (path: string) => Promise<PathAutocompleteResult>;
  browseDirectory?: () => Promise<string | null>;
}

const emptySettings = (): MediaLibrarySettingsInput => ({
  name: "",
  sourcePath: "",
  outputPath: "",
  folderTemplate: "{actor}/{number}",
  fileTemplate: "{number}",
  placement: "move",
  automation: "off",
  discovery: "events",
  cloudPath: "",
  scanIntervalMinutes: 15,
});

export function LibraryEditorDialog({
  open,
  library,
  importExisting = false,
  showAutomation,
  onOpenChange,
  onSave,
  onPreviewNaming,
  loadDirectorySuggestions,
  browseDirectory,
}: LibraryEditorDialogProps) {
  const t = useT();
  const [settings, setSettings] = useState<MediaLibrarySettingsInput>(emptySettings);
  const [submitError, setSubmitError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSettings(library ? { ...library } : { ...emptySettings(), ...(importExisting ? { placement: "inPlace" } : {}) });
    setSubmitError("");
    setShowErrors(false);
  }, [library, importExisting, open]);

  const parsed = useMemo(() => mediaLibrarySettingsSchema.safeParse(settings), [settings]);
  const fieldErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    if (parsed.success) return errors;
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "");
      errors[field] ??= t.libraries.issues[issue.message] ?? issue.message;
    }
    return errors;
  }, [parsed, t]);
  const set = <K extends keyof MediaLibrarySettingsInput>(key: K, value: MediaLibrarySettingsInput[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));
  const placement = settings.placement ?? "move";
  const needsOutput = placement !== "inPlace";

  const handleSave = async () => {
    setShowErrors(true);
    if (!parsed.success) return;
    setSaving(true);
    setSubmitError("");
    try {
      await onSave(parsed.data);
      onOpenChange(false);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {library
              ? t.libraries.editorEditTitle
              : importExisting
                ? t.libraries.importTitle
                : t.libraries.editorCreateTitle}
          </DialogTitle>
          <DialogDescription>
            {importExisting ? t.libraries.importExistingDescription : t.libraries.description}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <Field label={t.libraries.fields.name} error={showErrors ? fieldErrors.name : undefined}>
            {(id) => <Input id={id} value={settings.name} onChange={(event) => set("name", event.target.value)} />}
          </Field>
          <Field
            label={t.libraries.fields.sourcePath}
            hint={t.libraries.fields.sourcePathHint}
            error={showErrors ? fieldErrors.sourcePath : undefined}
          >
            {(id) => (
              <DirectoryInput
                id={id}
                value={settings.sourcePath}
                onChange={(value) => set("sourcePath", value)}
                loadSuggestions={loadDirectorySuggestions}
                browse={browseDirectory}
              />
            )}
          </Field>
          <Field label={t.libraries.fields.placement} hint={t.libraries.placements[placement].description}>
            {(id) => (
              <Select value={placement} onValueChange={(value) => set("placement", value as typeof placement)}>
                <SelectTrigger id={id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLACEMENT_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {t.libraries.placements[mode].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          {needsOutput ? (
            <Field
              label={t.libraries.fields.outputPath}
              hint={t.libraries.fields.outputPathHint}
              error={showErrors ? fieldErrors.outputPath : undefined}
            >
              {(id) => (
                <DirectoryInput
                  id={id}
                  value={settings.outputPath ?? ""}
                  onChange={(value) => set("outputPath", value)}
                  loadSuggestions={loadDirectorySuggestions}
                  browse={browseDirectory}
                />
              )}
            </Field>
          ) : null}
          {needsOutput ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t.libraries.fields.folderTemplate}
                labelAddon={<NamingTemplateHelp kind="folder" />}
                error={showErrors ? fieldErrors.folderTemplate : undefined}
              >
                {(id) => (
                  <Input
                    id={id}
                    className="font-mono"
                    value={settings.folderTemplate ?? ""}
                    onChange={(event) => set("folderTemplate", event.target.value)}
                  />
                )}
              </Field>
              <Field
                label={t.libraries.fields.fileTemplate}
                labelAddon={<NamingTemplateHelp kind="file" />}
                error={showErrors ? fieldErrors.fileTemplate : undefined}
              >
                {(id) => (
                  <Input
                    id={id}
                    className="font-mono"
                    value={settings.fileTemplate ?? ""}
                    onChange={(event) => set("fileTemplate", event.target.value)}
                  />
                )}
              </Field>
            </div>
          ) : null}
          {parsed.success ? <NamingPreview settings={parsed.data} onPreviewNaming={onPreviewNaming} /> : null}
          {showAutomation ? (
            <div className="space-y-5 border-t border-border/60 pt-5">
              <Field
                label={t.libraries.fields.automation}
                hint={t.libraries.automationLevels[settings.automation ?? "off"].description}
              >
                {(id) => (
                  <Select
                    value={settings.automation ?? "off"}
                    onValueChange={(value) => set("automation", value as MediaLibrarySettingsInput["automation"])}
                  >
                    <SelectTrigger id={id} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AUTOMATION_LEVELS.map((level) => (
                        <SelectItem key={level} value={level}>
                          {t.libraries.automationLevels[level].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
              {settings.automation !== "off" ? (
                <>
                  <p className="text-xs text-muted-foreground">{t.libraries.baselineNotice}</p>
                  <Field
                    label={t.libraries.fields.discovery}
                    hint={t.libraries.discoveryModes[settings.discovery ?? "events"].description}
                  >
                    {(id) => (
                      <Select
                        value={settings.discovery ?? "events"}
                        onValueChange={(value) => set("discovery", value as MediaLibrarySettingsInput["discovery"])}
                      >
                        <SelectTrigger id={id} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DISCOVERY_MODES.map((mode) => (
                            <SelectItem key={mode} value={mode}>
                              {t.libraries.discoveryModes[mode].label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </Field>
                  {settings.discovery === "clouddrive" ? (
                    <Field
                      label={t.libraries.fields.cloudPath}
                      hint={t.libraries.fields.cloudPathHint}
                      error={showErrors ? fieldErrors.cloudPath : undefined}
                    >
                      {(id) => (
                        <Input
                          id={id}
                          className="font-mono"
                          value={settings.cloudPath ?? ""}
                          onChange={(event) => set("cloudPath", event.target.value)}
                        />
                      )}
                    </Field>
                  ) : null}
                  <Field label={t.libraries.fields.scanIntervalMinutes} hint={t.libraries.fields.scanIntervalHint}>
                    {(id) => (
                      <Input
                        id={id}
                        type="number"
                        min={1}
                        max={1440}
                        value={settings.scanIntervalMinutes ?? 15}
                        onChange={(event) => set("scanIntervalMinutes", Number(event.target.value))}
                      />
                    )}
                  </Field>
                </>
              ) : null}
            </div>
          ) : null}
          {submitError ? (
            <div role="alert" className="text-sm text-destructive">
              {submitError}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t.common.cancel}
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {importExisting && !library ? t.libraries.importSave : t.libraries.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  labelAddon,
  hint,
  error,
  children,
}: {
  label: string;
  labelAddon?: ReactNode;
  hint?: string;
  error?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <Label htmlFor={id}>{label}</Label>
        {labelAddon}
      </div>
      {children(id)}
      {error ? (
        <div role="alert" className="text-xs text-destructive">
          {error}
        </div>
      ) : hint ? (
        <div className="text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}

function NamingPreview({
  settings,
  onPreviewNaming,
}: {
  settings: MediaLibrarySettingsInput;
  onPreviewNaming: (settings: MediaLibrarySettingsInput) => Promise<NamingPreviewItem[]>;
}) {
  const t = useT();
  const [items, setItems] = useState<NamingPreviewItem[]>([]);
  const [error, setError] = useState("");
  const key = JSON.stringify(settings);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      onPreviewNaming(JSON.parse(key) as MediaLibrarySettingsInput).then(
        (next) => {
          if (cancelled) return;
          setItems(next);
          setError("");
        },
        (reason: unknown) => {
          if (cancelled) return;
          setItems([]);
          setError(reason instanceof Error ? reason.message : String(reason));
        },
      );
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [key, onPreviewNaming]);

  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">{t.settings.namingPreview.title}</div>
      {items.length === 0 ? (
        <div role={error ? "alert" : undefined} className="text-xs text-muted-foreground">
          {error || t.settings.namingPreview.generating}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.sample} className="text-xs">
              <span className="mr-2 inline-block min-w-[4em] text-muted-foreground">
                {t.settings.namingPreviewSamples[item.sample]}
              </span>
              <div className="space-y-1 break-all font-mono">
                <div>{t.settings.namingPreview.source(item.sourcePath)}</div>
                <div>{t.settings.namingPreview.organized(item.mediaPath)}</div>
                {item.metadataDir ? <div>{t.settings.namingPreview.metadataDir(item.metadataDir)}</div> : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DirectoryInput({
  id,
  value,
  onChange,
  loadSuggestions,
  browse,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  loadSuggestions?: (path: string) => Promise<PathAutocompleteResult>;
  browse?: () => Promise<string | null>;
}) {
  return (
    <div className="flex items-center gap-2">
      <PathAutocompleteInput
        id={id}
        className="flex-1"
        value={value}
        onChange={onChange}
        loadSuggestions={loadSuggestions}
      />
      {browse ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0"
          onClick={async () => {
            const selected = await browse();
            if (selected) onChange(selected);
          }}
        >
          <FolderOpen className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}
