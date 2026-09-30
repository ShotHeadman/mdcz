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
  FormItem,
} from "@mdcz/ui";
import { useEffect, useMemo, useState } from "react";
import type { FieldValues } from "react-hook-form";
import { useFormContext, useFormState, useWatch } from "react-hook-form";
import { OrderedSiteFieldEditor } from "../config-form/OrderedSiteField";
import { useT } from "../i18n";
import { normalizeEnabledSites } from "./orderedSite";
import { buildOrderedSiteSummary } from "./orderedSiteSummary";
import { ResetToDefaultButton } from "./ResetToDefaultButton";
import { SettingRow } from "./SettingRow";
import { useOptionalSettingsSearch } from "./SettingsSearchContext";
import type { AggregationPriorityKey } from "./settingsRegistry";
import { useAutoSaveField } from "./useAutoSaveField";

interface AggregationPriorityEditorFieldProps {
  options: string[];
  name: AggregationPriorityKey;
}

function valuesEqual(a: string[], b: string[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const EDITOR_DIALOG_CLASS_NAME =
  "w-[94vw] max-w-[94vw] gap-0 overflow-hidden rounded-[var(--radius-quiet-xl)] border border-border/50 bg-surface-floating p-0 shadow-[0_32px_90px_-40px_rgba(15,23,42,0.45)] sm:w-[90vw] sm:max-w-[90vw] xl:w-[72vw] xl:max-w-[72vw]";

export function AggregationPriorityEditorField({ options, name }: AggregationPriorityEditorFieldProps) {
  const t = useT();
  const { label, description } = t.settingsFields.fields[name];
  const form = useFormContext<FieldValues>();
  const search = useOptionalSettingsSearch();
  const value = (useWatch({ control: form.control, name }) as string[] | undefined) ?? [];
  const fieldFormState = useFormState({ control: form.control, name });
  const normalizedValue = useMemo(() => normalizeEnabledSites(value), [value]);
  const availableOptions = useMemo(
    () => normalizeEnabledSites([...options, ...normalizedValue]),
    [normalizedValue, options],
  );
  const summary = useMemo(
    () => buildOrderedSiteSummary(normalizedValue, availableOptions),
    [availableOptions, normalizedValue],
  );
  const { resetToDefault } = useAutoSaveField(name, { mode: "immediate" });
  const [open, setOpen] = useState(false);
  const [draftValue, setDraftValue] = useState<string[]>(normalizedValue);

  useEffect(() => {
    if (!open) {
      setDraftValue(normalizedValue);
    }
  }, [normalizedValue, open]);

  const visible = search ? search.isFieldVisible(name) : true;
  const highlighted = search ? search.isFieldHighlighted(name) : false;
  const modified = search ? search.isFieldModified(name) : false;
  const hasChanges = !valuesEqual(normalizeEnabledSites(draftValue), normalizedValue);
  const rowError = (() => {
    const error = form.getFieldState(name, fieldFormState).error;
    return error && typeof error.message === "string" ? error.message : null;
  })();
  const applyDraft = () => {
    form.setValue(name, normalizeEnabledSites(draftValue), {
      shouldDirty: true,
      shouldTouch: true,
    });
    setOpen(false);
  };

  if (!visible) {
    return null;
  }

  return (
    <>
      <FormItem className="block space-y-0">
        <SettingRow
          fieldName={name}
          label={label}
          description={description}
          error={rowError}
          headerAction={modified ? <ResetToDefaultButton label={label} onClick={resetToDefault} /> : null}
          highlighted={highlighted}
          control={
            <div className="flex items-center gap-3">
              <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
                <span className="rounded-[var(--radius-quiet-capsule)] border border-border/50 bg-surface-low px-2.5 py-1">
                  {t.settings.aggregationPriority.candidatesSummary(summary.enabledCount, summary.totalCount)}
                </span>
                {summary.preview.map((site) => (
                  <span
                    key={site}
                    className="rounded-[var(--radius-quiet-capsule)] border border-border/40 bg-surface px-2.5 py-1 font-mono text-[11px] text-foreground/80"
                  >
                    {site}
                  </span>
                ))}
                {summary.remainingCount > 0 && (
                  <span className="rounded-[var(--radius-quiet-capsule)] bg-surface-low px-2.5 py-1">
                    +{summary.remainingCount}
                  </span>
                )}
              </div>
              <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
                {t.settings.editorDialog.edit}
              </Button>
            </div>
          }
        />
      </FormItem>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={EDITOR_DIALOG_CLASS_NAME}>
          <DialogHeader className="gap-3 px-7 pt-7 text-left">
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              {t.settings.aggregationPriority.eyebrow}
            </p>
            <DialogTitle className="text-2xl font-semibold tracking-tight">{label}</DialogTitle>
            <DialogDescription className="max-w-2xl text-sm leading-6">{description}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[min(74vh,880px)] overflow-y-auto border-y border-border/50 px-6 py-6">
            <section className="space-y-4">
              <header className="space-y-1">
                <h3 className="font-numeric text-lg font-semibold tracking-[-0.02em] text-foreground">{label}</h3>
                <p className="text-sm leading-6 text-muted-foreground">{t.settings.aggregationPriority.hint}</p>
              </header>
              <OrderedSiteFieldEditor value={draftValue} options={availableOptions} onChange={setDraftValue} />
            </section>
          </div>
          <DialogFooter className="gap-2 px-6 pb-6">
            <DialogClose asChild>
              <Button variant="outline" className="rounded-[var(--radius-quiet-capsule)] px-5">
                {t.settings.editorDialog.close}
              </Button>
            </DialogClose>
            <Button
              className={cn("rounded-[var(--radius-quiet-capsule)] px-5")}
              onClick={hasChanges ? applyDraft : () => setOpen(false)}
            >
              {hasChanges ? t.settings.editorDialog.applyOrder : t.settings.editorDialog.done}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
