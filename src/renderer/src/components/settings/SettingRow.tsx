import { type ReactNode, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useOptionalSettingsSearch } from "./SettingsSearchContext";

interface SettingRowProps {
  fieldName?: string;
  label: string;
  description?: string;
  htmlFor?: string;
  headerAction?: ReactNode;
  control: ReactNode;
  status?: ReactNode;
  error?: string | null;
  className?: string;
  /**
   * When true, the control stacks below the label+description on a full-width
   * row. Used by textarea-heavy fields (Cookie, Prompt). Defaults to false,
   * matching the right-aligned inline layout in `src/renderer/ui/settings/code.html`.
   */
  fullWidthContent?: boolean;
  /** When true, apply a dimmed visual to indicate this row is filtered out by search. */
  dimmed?: boolean;
  /** When true, apply a subtle highlight to indicate this row matches the current search. */
  highlighted?: boolean;
}

export function SettingRow({
  fieldName,
  label,
  description,
  htmlFor,
  headerAction,
  control,
  status,
  error,
  className,
  fullWidthContent,
  dimmed,
  highlighted,
}: SettingRowProps) {
  const search = useOptionalSettingsSearch();
  const registerFieldNode = useCallback(
    (node: HTMLDivElement | null) => {
      if (!search || !fieldName) {
        return;
      }

      search.registerFieldNode(fieldName, node);
    },
    [fieldName, search],
  );

  return (
    <div
      ref={fieldName ? registerFieldNode : undefined}
      data-field-name={fieldName}
      className={cn(
        "group/setting-row flex py-3 transition-[opacity,background-color] duration-200",
        fullWidthContent
          ? "flex-col gap-2.5"
          : "flex-col gap-2.5 md:flex-row md:items-start md:justify-between md:gap-6",
        highlighted && "rounded-[var(--radius-quiet-sm)] -mx-2 px-2 bg-primary/5",
        dimmed && "opacity-40",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <label htmlFor={htmlFor} className="block font-numeric text-sm font-bold tracking-tight text-foreground">
            {label}
          </label>
          {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
        </div>
        {description && <p className="mt-1 max-w-prose text-xs text-muted-foreground">{description}</p>}
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      {fullWidthContent ? (
        <div className="flex flex-col gap-2">
          <div data-setting-control>{control}</div>
          {status && (
            <div aria-live="polite" className="flex min-h-[1rem] justify-end text-xs text-muted-foreground">
              {status}
            </div>
          )}
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-2.5">
          <div data-setting-control className="min-w-0">
            {control}
          </div>
          {status && (
            <div
              aria-live="polite"
              className="flex min-w-[4.5rem] min-h-[1rem] items-center justify-end text-xs text-muted-foreground"
            >
              {status}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
