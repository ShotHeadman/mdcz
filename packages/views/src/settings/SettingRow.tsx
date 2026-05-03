import { cn } from "@mdcz/ui";
import { type ReactNode, useCallback } from "react";
import { useOptionalSettingsSearch } from "./SettingsSearchContext";

type SettingRowLayout = "horizontal" | "vertical";

interface SettingRowProps {
  fieldName?: string;
  label: string;
  description?: string;
  htmlFor?: string;
  labelAddon?: ReactNode;
  headerAction?: ReactNode;
  control: ReactNode;
  error?: string | null;
  className?: string;
  controlClassName?: string;
  layout?: SettingRowLayout;
  /** When true, apply a subtle highlight to indicate this row matches the current search. */
  highlighted?: boolean;
}

export function SettingRow({
  fieldName,
  label,
  description,
  htmlFor,
  labelAddon,
  headerAction,
  control,
  error,
  className,
  controlClassName,
  layout = "horizontal",
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

  const isVerticalLayout = layout === "vertical";

  return (
    <div
      ref={fieldName ? registerFieldNode : undefined}
      data-field-name={fieldName}
      className={cn(
        "group/setting-row flex py-3 transition-[opacity,background-color] duration-200",
        isVerticalLayout
          ? "flex-col gap-2.5"
          : "flex-col gap-2.5 md:flex-row md:items-start md:justify-between md:gap-6",
        highlighted && "rounded-[var(--radius-quiet-sm)] -mx-2 px-2 bg-primary/5",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-h-6 items-center gap-2">
          <label
            htmlFor={htmlFor}
            className="block min-h-6 font-numeric text-sm leading-6 font-bold tracking-tight text-foreground"
          >
            {label}
          </label>
          {labelAddon ? <div className="flex h-6 shrink-0 items-center">{labelAddon}</div> : null}
          {headerAction ? <div className="flex h-6 shrink-0 items-center">{headerAction}</div> : null}
        </div>
        {description && <p className="mt-1 max-w-prose text-xs text-muted-foreground">{description}</p>}
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      {isVerticalLayout ? (
        <div className="flex flex-col gap-2">
          <div data-setting-control className={controlClassName}>
            {control}
          </div>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-2.5">
          <div data-setting-control className={cn("min-w-0", controlClassName)}>
            {control}
          </div>
        </div>
      )}
    </div>
  );
}
