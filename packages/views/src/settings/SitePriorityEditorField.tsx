import { Website } from "@mdcz/shared/enums";
import { DEFAULT_R18_METADATA_LANGUAGE, type R18MetadataLanguage } from "@mdcz/shared/r18";
import {
  Button,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormItem,
} from "@mdcz/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FieldValues } from "react-hook-form";
import { useFormContext, useFormState, useWatch } from "react-hook-form";
import { OrderedSiteFieldEditor, type OrderedSiteFieldRow } from "../config-form/OrderedSiteField";
import { normalizeEnabledSites } from "./orderedSite";
import type { OrderedSiteSummary } from "./orderedSiteSummary";
import { ResetToDefaultButton } from "./ResetToDefaultButton";
import { SettingRow } from "./SettingRow";
import { useOptionalSettingsSearch } from "./SettingsSearchContext";
import { SiteConnectivityPill } from "./SiteConnectivityPill";
import {
  buildGroupedSitePrioritySummary,
  moveSitePriorityOption,
  resolveSitePriorityOptions,
  type SitePriorityOptionId,
  setAllSitePriorityOptions,
  toggleSitePriorityOption,
} from "./sitePriorityOptions";
import { useAutoSaveField } from "./useAutoSaveField";

interface SitePriorityEditorFieldProps {
  options: string[];
  name?: string;
  label?: string;
  description?: string;
}

function valuesEqual(a: string[], b: string[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function buildSitePrioritySummary(value: unknown, options: string[]): OrderedSiteSummary {
  return buildGroupedSitePrioritySummary(value, options);
}

const EDITOR_DIALOG_CLASS_NAME =
  "w-[94vw] max-w-[94vw] gap-0 overflow-hidden rounded-[var(--radius-quiet-xl)] border border-border/50 bg-surface-floating p-0 shadow-[0_32px_90px_-40px_rgba(15,23,42,0.45)] sm:w-[90vw] sm:max-w-[90vw] xl:w-[84vw] xl:max-w-[84vw]";

const WEBSITE_VALUES = new Set<string>(Object.values(Website));
const R18_LANGUAGE_FIELD_NAME = "scrape.r18MetadataLanguage";
const R18_LANGUAGE_OPTIONS: Array<{ value: R18MetadataLanguage; label: string }> = [
  { value: "ja", label: "日文" },
  { value: "en", label: "英文" },
];

const toConcreteWebsites = (sites: string[]): Website[] =>
  sites.filter((site): site is Website => WEBSITE_VALUES.has(site));

const normalizeR18Language = (value: unknown): R18MetadataLanguage =>
  value === "en" || value === "ja" ? value : DEFAULT_R18_METADATA_LANGUAGE;

function R18LanguagePreferenceControl({
  value,
  onChange,
}: {
  value: R18MetadataLanguage;
  onChange: (value: R18MetadataLanguage) => void;
}) {
  return (
    <fieldset className="inline-flex rounded-[var(--radius-quiet-capsule)] border border-border/50 bg-surface-low p-0.5">
      <legend className="sr-only">R18.dev 元数据语言</legend>
      {R18_LANGUAGE_OPTIONS.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-7 rounded-[var(--radius-quiet-capsule)] px-2.5 text-[11px] font-medium text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
              active && "bg-surface-floating text-foreground shadow-[0_8px_18px_-16px_rgba(15,23,42,0.5)]",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </fieldset>
  );
}

export function SitePriorityEditorField({
  options,
  name = "scrape.sites",
  label = "启用站点与优先级",
}: SitePriorityEditorFieldProps) {
  const form = useFormContext<FieldValues>();
  const search = useOptionalSettingsSearch();
  const value = (useWatch({ control: form.control, name }) as string[] | undefined) ?? [];
  const r18Language = normalizeR18Language(useWatch({ control: form.control, name: R18_LANGUAGE_FIELD_NAME }));
  const fieldFormState = useFormState({ control: form.control, name });
  const normalizedValue = useMemo(() => normalizeEnabledSites(value), [value]);
  const availableOptions = useMemo(
    () => normalizeEnabledSites([...options, ...normalizedValue]),
    [normalizedValue, options],
  );
  const summary = useMemo(
    () => buildSitePrioritySummary(normalizedValue, availableOptions),
    [availableOptions, normalizedValue],
  );
  const { resetToDefault } = useAutoSaveField(name, { mode: "immediate", label });
  useAutoSaveField(R18_LANGUAGE_FIELD_NAME, { mode: "immediate", label: "R18.dev 元数据语言" });
  const [open, setOpen] = useState(false);
  const [draftValue, setDraftValue] = useState<string[]>(normalizedValue);
  const draftSummary = useMemo(
    () => buildSitePrioritySummary(draftValue, availableOptions),
    [availableOptions, draftValue],
  );
  const siteOptions = useMemo(
    () => resolveSitePriorityOptions(draftValue, availableOptions),
    [availableOptions, draftValue],
  );
  const connectivitySites = useMemo(() => toConcreteWebsites(normalizeEnabledSites(draftValue)), [draftValue]);
  const handleR18LanguageChange = useCallback(
    (language: R18MetadataLanguage) => {
      form.setValue(R18_LANGUAGE_FIELD_NAME, language, {
        shouldDirty: true,
        shouldTouch: true,
      });
    },
    [form],
  );
  const siteRows = useMemo<OrderedSiteFieldRow<SitePriorityOptionId>[]>(
    () =>
      siteOptions.map((option) => ({
        id: option.id,
        label: option.label,
        description: option.description,
        checkboxState: option.state === "all" ? true : option.state === "partial" ? "indeterminate" : false,
        labelMonospace: option.sites.length === 1,
        chips: [
          ...(option.memberLabel ? [{ label: option.memberLabel, monospace: true, variant: "outline" as const }] : []),
          ...(option.statusLabel ? [{ label: option.statusLabel, variant: "soft" as const }] : []),
        ],
        trailingControl:
          option.id === Website.R18_DEV ? (
            <R18LanguagePreferenceControl value={r18Language} onChange={handleR18LanguageChange} />
          ) : undefined,
      })),
    [handleR18LanguageChange, r18Language, siteOptions],
  );

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
          error={rowError}
          headerAction={modified ? <ResetToDefaultButton label={label} onClick={resetToDefault} /> : null}
          highlighted={highlighted}
          control={
            <div className="flex items-center gap-3">
              <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
                <span className="rounded-[var(--radius-quiet-capsule)] border border-border/50 bg-surface-low px-2.5 py-1">
                  已启用 {summary.enabledCount}/{summary.totalCount}
                </span>
                {summary.preview.map((site) => (
                  <span
                    key={site}
                    className="rounded-[var(--radius-quiet-capsule)] border border-border/40 bg-surface px-2.5 py-1 text-[11px] font-medium text-foreground/80"
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
          <DialogHeader className="gap-3 px-7 pt-7 pb-2 text-left">
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">刮削站点</p>
            <DialogTitle className="text-2xl font-semibold tracking-tight">{label}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[min(74vh,880px)] overflow-y-auto border-y border-border/50 px-6 py-6">
            <div className="space-y-8">
              <section className="space-y-4">
                <p className="text-sm leading-6 text-muted-foreground">勾选启用站点，上下移动调整优先级。</p>
                <OrderedSiteFieldEditor
                  value={draftValue}
                  options={availableOptions}
                  onChange={setDraftValue}
                  rows={siteRows}
                  selectedCount={draftSummary.enabledCount}
                  totalCount={draftSummary.totalCount}
                  onSelectAll={() => setDraftValue(setAllSitePriorityOptions(draftValue, availableOptions))}
                  onClearAll={() => setDraftValue([])}
                  onToggleRow={(rowId, enabled) =>
                    setDraftValue(toggleSitePriorityOption(draftValue, availableOptions, rowId, enabled))
                  }
                  onMoveRow={(rowId, direction) =>
                    setDraftValue(moveSitePriorityOption(draftValue, availableOptions, rowId, direction))
                  }
                />
              </section>
              {connectivitySites.length > 0 && (
                <section className="space-y-3">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">站点连通性</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      使用当前网络、代理和 Cookie 配置检测已启用站点。
                    </p>
                  </div>
                  <div className="divide-y overflow-hidden rounded-[var(--radius-quiet-lg)] border border-border/60 bg-surface">
                    {connectivitySites.map((site) => (
                      <div key={site} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                        <span className="mr-auto font-mono text-xs text-foreground/85">{site}</span>
                        <SiteConnectivityPill site={site} />
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2 px-6 pb-6">
            <DialogClose asChild>
              <Button variant="outline" className="rounded-[var(--radius-quiet-capsule)] px-5">
                关闭
              </Button>
            </DialogClose>
            <Button
              className="rounded-[var(--radius-quiet-capsule)] px-5"
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
