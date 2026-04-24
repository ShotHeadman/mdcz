import { ArrowDown, ArrowUp } from "lucide-react";
import type { ControllerRenderProps, FieldValues } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { FormControl } from "@/components/ui/Form";
import { cn } from "@/lib/utils";
import { normalizeEnabledSites } from "@/utils/orderedSite";

type OrderedSiteFieldCheckboxState = boolean | "indeterminate";

export interface OrderedSiteFieldChip {
  label: string;
  monospace?: boolean;
  variant?: "outline" | "soft";
}

export interface OrderedSiteFieldRow<RowId extends string = string> {
  id: RowId;
  label: string;
  description?: string;
  chips?: OrderedSiteFieldChip[];
  checkboxState: OrderedSiteFieldCheckboxState;
  labelMonospace?: boolean;
}

interface OrderedSiteFieldProps<RowId extends string = string> {
  value: string[];
  options: string[];
  onChange: (sites: string[]) => void;
  rows?: OrderedSiteFieldRow<RowId>[];
  selectedCount?: number;
  totalCount?: number;
  countLabel?: string;
  selectAllLabel?: string;
  clearAllLabel?: string;
  onToggleRow?: (rowId: RowId, enabled: boolean) => void;
  onMoveRow?: (rowId: RowId, direction: -1 | 1) => void;
  onSelectAll?: () => void;
  onClearAll?: () => void;
}

interface OrderedSiteFieldWrapperProps {
  field: ControllerRenderProps<FieldValues, string>;
  options: string[];
}

const getChipClassName = (chip: OrderedSiteFieldChip): string =>
  cn(
    "rounded-[var(--radius-quiet-capsule)] px-2 py-0.5 text-[10px] text-muted-foreground",
    chip.variant === "outline" ? "border border-border/40 bg-surface-low" : "bg-surface-low",
    chip.monospace && "font-mono",
  );

export function OrderedSiteFieldEditor<RowId extends string = string>({
  value,
  options,
  onChange,
  rows,
  selectedCount,
  totalCount,
  countLabel = "已启用",
  selectAllLabel = "全选",
  clearAllLabel = "全不选",
  onToggleRow,
  onMoveRow,
  onSelectAll,
  onClearAll,
}: OrderedSiteFieldProps<RowId>) {
  const enabledSites = normalizeEnabledSites(value);
  const disabledSites = options.filter((site) => !enabledSites.includes(site));
  const visibleSites = [...enabledSites, ...disabledSites];
  const usesCustomRows = Array.isArray(rows);
  const resolvedRows = (rows ??
    visibleSites.map((site) => ({
      id: site,
      label: site,
      checkboxState: enabledSites.includes(site),
      labelMonospace: true,
    }))) as OrderedSiteFieldRow<RowId>[];

  const setEnabledSites = (sites: string[]) => {
    onChange(normalizeEnabledSites(sites));
  };

  const toggleSite = (site: string, enabled: boolean) => {
    if (enabled) {
      setEnabledSites([...enabledSites, site]);
      return;
    }

    setEnabledSites(enabledSites.filter((candidate) => candidate !== site));
  };

  const moveSite = (site: string, direction: -1 | 1) => {
    const index = enabledSites.indexOf(site);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= enabledSites.length) {
      return;
    }

    const nextSites = [...enabledSites];
    [nextSites[index], nextSites[nextIndex]] = [nextSites[nextIndex], nextSites[index]];
    setEnabledSites(nextSites);
  };

  const handleToggleRow = (rowId: RowId, enabled: boolean) => {
    if (usesCustomRows) {
      onToggleRow?.(rowId, enabled);
      return;
    }

    toggleSite(rowId, enabled);
  };

  const handleMoveRow = (rowId: RowId, direction: -1 | 1) => {
    if (usesCustomRows) {
      onMoveRow?.(rowId, direction);
      return;
    }

    moveSite(rowId, direction);
  };

  const handleSelectAll = () => {
    if (usesCustomRows) {
      onSelectAll?.();
      return;
    }

    setEnabledSites(options);
  };

  const handleClearAll = () => {
    if (usesCustomRows) {
      onClearAll?.();
      return;
    }

    setEnabledSites([]);
  };

  const enabledRows = resolvedRows.filter((row) => row.checkboxState !== false);
  const resolvedSelectedCount = selectedCount ?? enabledRows.length;
  const resolvedTotalCount = totalCount ?? resolvedRows.length;
  const canSelectAll = !usesCustomRows || onSelectAll !== undefined;
  const canClearAll = !usesCustomRows || onClearAll !== undefined;
  const canToggleRows = !usesCustomRows || onToggleRow !== undefined;

  return (
    <FormControl>
      <div className="divide-y overflow-hidden rounded-[var(--radius-quiet-lg)] border border-border/60 bg-surface">
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <span className="mr-auto">
            {countLabel} {resolvedSelectedCount}/{resolvedTotalCount}
          </span>
          <Button type="button" variant="ghost" size="xs" onClick={handleSelectAll} disabled={!canSelectAll}>
            {selectAllLabel}
          </Button>
          <Button type="button" variant="ghost" size="xs" onClick={handleClearAll} disabled={!canClearAll}>
            {clearAllLabel}
          </Button>
        </div>

        {resolvedRows.map((row) => {
          const enabled = row.checkboxState !== false;
          const enabledIndex = enabledRows.findIndex((candidate) => candidate.id === row.id);
          const hasDetails = Boolean(row.description) || (row.chips?.length ?? 0) > 0;
          const labelClassName = row.labelMonospace ? "font-mono text-xs" : "font-medium text-foreground";
          const moveDisabled =
            usesCustomRows && onMoveRow === undefined
              ? true
              : !enabled || enabledIndex < 0 || enabledIndex >= enabledRows.length - 1;
          const moveUpDisabled = usesCustomRows && onMoveRow === undefined ? true : !enabled || enabledIndex <= 0;

          return (
            <div
              key={row.id}
              className={cn(
                "grid grid-cols-[auto_1fr_auto] gap-3 px-3 text-sm",
                hasDetails ? "items-start py-3" : "items-center py-2.5",
                !enabled && "text-muted-foreground",
              )}
            >
              <Checkbox
                checked={row.checkboxState}
                disabled={!canToggleRows}
                onCheckedChange={(checked) => handleToggleRow(row.id, checked === true)}
              />
              <div className={cn("min-w-0", hasDetails && "space-y-1")}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn(labelClassName, !enabled && "text-muted-foreground")}>{row.label}</span>
                  {row.chips?.map((chip, index) => (
                    <span key={`${row.id}-${chip.label}-${index}`} className={getChipClassName(chip)}>
                      {chip.label}
                    </span>
                  ))}
                </div>
                {row.description && <p className="text-xs leading-5 text-muted-foreground">{row.description}</p>}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={moveUpDisabled}
                  onClick={() => handleMoveRow(row.id, -1)}
                  aria-label={`上移 ${row.label}`}
                >
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={moveDisabled}
                  onClick={() => handleMoveRow(row.id, 1)}
                  aria-label={`下移 ${row.label}`}
                >
                  <ArrowDown className="size-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </FormControl>
  );
}

export function OrderedSiteField({ field, options }: OrderedSiteFieldWrapperProps) {
  return (
    <OrderedSiteFieldEditor
      value={Array.isArray(field.value) ? (field.value as string[]) : []}
      options={options}
      onChange={field.onChange}
    />
  );
}
