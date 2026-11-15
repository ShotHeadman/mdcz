import type { PendingItemDto, PendingKindDto } from "@mdcz/shared/pending";
import { Badge, cn } from "@mdcz/ui";
import { AlertCircle, FilePlus2, FileQuestion, Layers, type LucideIcon, SearchX, Tag } from "lucide-react";
import { formatDateTime, useT } from "../i18n";

const KIND_BADGE_META: Record<PendingKindDto, { className: string; icon: LucideIcon; iconClassName?: string }> = {
  uncensored: {
    className: "border-foreground bg-foreground text-background shadow-2xs",
    icon: Tag,
  },
  ambiguous: {
    className: "border-foreground/25 bg-surface text-foreground shadow-2xs",
    icon: Layers,
    iconClassName: "text-foreground/80",
  },
  new_file: {
    className: "border-border bg-surface text-foreground/85",
    icon: FilePlus2,
    iconClassName: "text-muted-foreground",
  },
  not_found: {
    className: "border-border/80 bg-surface-raised/75 text-foreground/85",
    icon: SearchX,
    iconClassName: "text-muted-foreground",
  },
  failed: {
    className: "border-border/80 bg-surface-raised/75 text-foreground/85",
    icon: AlertCircle,
    iconClassName: "text-muted-foreground",
  },
  no_number: {
    className: "border-border/60 bg-surface-low text-muted-foreground",
    icon: FileQuestion,
    iconClassName: "text-muted-foreground/75",
  },
};

export function KindBadge({ kind }: { kind: PendingKindDto }) {
  const t = useT();
  const { className, icon: Icon, iconClassName } = KIND_BADGE_META[kind];
  return (
    <Badge variant="outline" className={cn("gap-1.5 px-2.5 py-0.5 font-medium tracking-tight", className)}>
      <Icon className={cn("size-3 shrink-0", iconClassName)} />
      {t.pending.kinds[kind]}
    </Badge>
  );
}

/** A pending file as the list shows it: why it waits, its number, its name and its library. */
export function PendingItemSummary({ item }: { item: PendingItemDto }) {
  const t = useT();
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <KindBadge kind={item.kind} />
        {item.number ? (
          <span className="rounded border border-border/60 bg-surface-low/70 px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-tight text-muted-foreground">
            {item.number}
          </span>
        ) : null}
      </div>
      <div className="mt-2 truncate text-sm font-semibold tracking-tight" title={item.path}>
        {item.fileName}
      </div>
      <div className="mt-0.5 truncate text-xs text-muted-foreground">
        {item.libraryName ?? t.pending.noLibrary} · {t.pending.updated(formatDateTime(item.updatedAt))}
      </div>
    </>
  );
}
