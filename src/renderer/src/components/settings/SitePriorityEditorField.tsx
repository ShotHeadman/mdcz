import { useEffect, useMemo, useState } from "react";
import type { FieldValues } from "react-hook-form";
import { useFormContext, useWatch } from "react-hook-form";
import { normalizeEnabledSites, OrderedSiteFieldEditor } from "@/components/config-form/OrderedSiteField";
import { SiteConfigSection } from "@/components/config-form/SiteConfigSection";
import { AutoSaveStatusIndicator } from "@/components/settings/AutoSaveStatusIndicator";
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

interface SitePriorityEditorFieldProps {
  options: string[];
  name?: string;
  label?: string;
  description?: string;
}

interface SitePrioritySummary {
  enabledCount: number;
  totalCount: number;
  preview: string[];
  remainingCount: number;
}

function valuesEqual(a: string[], b: string[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function buildSitePrioritySummary(value: unknown, options: string[]): SitePrioritySummary {
  const enabledSites = normalizeEnabledSites(
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [],
  );
  const preview = enabledSites.slice(0, 3);

  return {
    enabledCount: enabledSites.length,
    totalCount: options.length,
    preview,
    remainingCount: Math.max(0, enabledSites.length - preview.length),
  };
}

const EDITOR_DIALOG_CLASS_NAME =
  "w-[94vw] max-w-[94vw] gap-0 overflow-hidden rounded-[var(--radius-quiet-xl)] border border-border/50 bg-surface-floating p-0 shadow-[0_32px_90px_-40px_rgba(15,23,42,0.45)] sm:w-[90vw] sm:max-w-[90vw] xl:w-[84vw] xl:max-w-[84vw]";

export function SitePriorityEditorField({
  options,
  name = "scrape.sites",
  label = "启用站点与优先级",
  description = "勾选启用站点，上下移动调整优先级。",
}: SitePriorityEditorFieldProps) {
  const form = useFormContext<FieldValues>();
  const search = useOptionalSettingsSearch();
  const value = (useWatch({ control: form.control, name }) as string[] | undefined) ?? [];
  const normalizedValue = useMemo(() => normalizeEnabledSites(value), [value]);
  const summary = useMemo(() => buildSitePrioritySummary(normalizedValue, options), [normalizedValue, options]);
  const { status, error } = useAutoSaveField(name, { mode: "immediate" });
  const [open, setOpen] = useState(false);
  const [draftValue, setDraftValue] = useState<string[]>(normalizedValue);

  useEffect(() => {
    if (!open) {
      setDraftValue(normalizedValue);
    }
  }, [normalizedValue, open]);

  const highlighted = Boolean(search?.isSearching && search.isMatch(label, name));
  const dimmed = Boolean(search?.isSearching && !search.isMatch(label, name));
  const hasChanges = !valuesEqual(normalizeEnabledSites(draftValue), normalizedValue);

  const applyDraft = () => {
    form.setValue(name, normalizeEnabledSites(draftValue), {
      shouldDirty: true,
      shouldTouch: true,
    });
    setOpen(false);
  };

  return (
    <>
      <FormItem className="block space-y-0" data-field-name={name}>
        <SettingRow
          label={label}
          description={description}
          error={error}
          status={<AutoSaveStatusIndicator status={status} />}
          highlighted={highlighted}
          dimmed={dimmed}
          control={
            <div className="flex items-center gap-3">
              <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
                <span className="rounded-[var(--radius-quiet-capsule)] border border-border/50 bg-surface-low px-2.5 py-1">
                  已启用 {summary.enabledCount}/{summary.totalCount}
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
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">刮削站点</p>
            <DialogTitle className="text-2xl font-semibold tracking-tight">{label}</DialogTitle>
            <DialogDescription className="max-w-2xl text-sm leading-6">{description}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[min(74vh,880px)] overflow-y-auto border-y border-border/50 px-6 py-6">
            <div className="space-y-8">
              <section className="space-y-4">
                <header className="space-y-1">
                  <h3 className="font-numeric text-lg font-semibold tracking-[-0.02em] text-foreground">
                    启用站点与优先级
                  </h3>
                  <p className="text-sm leading-6 text-muted-foreground">勾选启用站点，上下移动调整优先级。</p>
                </header>
                <OrderedSiteFieldEditor value={draftValue} options={options} onChange={setDraftValue} />
              </section>

              <section className="space-y-4">
                <header className="space-y-1">
                  <h3 className="font-numeric text-lg font-semibold tracking-[-0.02em] text-foreground">
                    站点地址与连通性
                  </h3>
                  <p className="text-sm leading-6 text-muted-foreground">
                    为已启用站点覆盖内置地址，并直接在这里测试当前代理、Cookie 与站点连通性。
                  </p>
                </header>
                <SiteConfigSection sitesOverride={draftValue} />
              </section>
            </div>
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
