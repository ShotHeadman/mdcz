import { useEffect, useMemo, useState } from "react";
import type { FieldValues } from "react-hook-form";
import { useFormContext, useFormState, useWatch } from "react-hook-form";
import { normalizeEnabledSites, OrderedSiteFieldEditor } from "@/components/config-form/OrderedSiteField";
import { AutoSaveStatusIndicator } from "@/components/settings/AutoSaveStatusIndicator";
import { buildOrderedSiteSummary } from "@/components/settings/orderedSiteSummary";
import { ResetToDefaultButton } from "@/components/settings/ResetToDefaultButton";
import { SettingRow } from "@/components/settings/SettingRow";
import { useOptionalSettingsSearch } from "@/components/settings/SettingsSearchContext";
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
import { FormItem } from "@/components/ui/Form";
import { useAutoSaveField } from "@/hooks/useAutoSaveField";
import { cn } from "@/lib/utils";

interface AggregationPriorityEditorFieldProps {
  options: string[];
  name: string;
  label: string;
  description?: string;
}

function valuesEqual(a: string[], b: string[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const EDITOR_DIALOG_CLASS_NAME =
  "w-[94vw] max-w-[94vw] gap-0 overflow-hidden rounded-[var(--radius-quiet-xl)] border border-border/50 bg-surface-floating p-0 shadow-[0_32px_90px_-40px_rgba(15,23,42,0.45)] sm:w-[90vw] sm:max-w-[90vw] xl:w-[72vw] xl:max-w-[72vw]";

export function AggregationPriorityEditorField({
  options,
  name,
  label,
  description = "按顺序选择这个字段优先采用哪些站点；未列出的站点会在后面按实际抓取结果补位。",
}: AggregationPriorityEditorFieldProps) {
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
  const { status, resetToDefault } = useAutoSaveField(name, { mode: "immediate", label });
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
          status={<AutoSaveStatusIndicator status={status} />}
          highlighted={highlighted}
          control={
            <div className="flex items-center gap-3">
              <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
                <span className="rounded-[var(--radius-quiet-capsule)] border border-border/50 bg-surface-low px-2.5 py-1">
                  候选 {summary.enabledCount}/{summary.totalCount}
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
                编辑
              </Button>
            </div>
          }
        />
      </FormItem>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={EDITOR_DIALOG_CLASS_NAME}>
          <DialogHeader className="gap-3 px-7 pt-7 text-left">
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">字段聚合</p>
            <DialogTitle className="text-2xl font-semibold tracking-tight">{label}</DialogTitle>
            <DialogDescription className="max-w-2xl text-sm leading-6">{description}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[min(74vh,880px)] overflow-y-auto border-y border-border/50 px-6 py-6">
            <section className="space-y-4">
              <header className="space-y-1">
                <h3 className="font-numeric text-lg font-semibold tracking-[-0.02em] text-foreground">{label}</h3>
                <p className="text-sm leading-6 text-muted-foreground">
                  勾选参与聚合的站点并调整顺序；未列出的站点会在这些候选之后补位。
                </p>
              </header>
              <OrderedSiteFieldEditor value={draftValue} options={availableOptions} onChange={setDraftValue} />
            </section>
          </div>
          <DialogFooter className="gap-2 px-6 pb-6">
            <DialogClose asChild>
              <Button variant="outline" className="rounded-[var(--radius-quiet-capsule)] px-5">
                关闭
              </Button>
            </DialogClose>
            <Button
              className={cn("rounded-[var(--radius-quiet-capsule)] px-5")}
              onClick={hasChanges ? applyDraft : () => setOpen(false)}
            >
              {hasChanges ? "应用排序更改" : "完成"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
