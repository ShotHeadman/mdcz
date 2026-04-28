import { CheckCircle2, LoaderCircle, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/ContextMenu";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { cn } from "@/lib/utils";

export type MediaBrowserFilter = "all" | "success" | "failed";
export type MediaBrowserItemStatus = "success" | "failed" | "processing" | "idle";

export interface MediaBrowserItem {
  id: string;
  active: boolean;
  title: string;
  subtitle?: string;
  errorText?: string;
  status?: MediaBrowserItemStatus;
  selectionControl?: ReactNode;
  menuContent: ReactNode;
  onClick: () => void;
}

interface MediaBrowserStat {
  label: string;
  value: string;
  tone?: "default" | "positive" | "negative";
}

interface MediaBrowserListProps {
  items: MediaBrowserItem[];
  filter: MediaBrowserFilter;
  onFilterChange: (filter: MediaBrowserFilter) => void;
  emptyMessage?: string;
  emptyContent?: ReactNode;
  headerLeading?: ReactNode;
  headerTrailing?: ReactNode;
  title?: string;
  stats?: MediaBrowserStat[];
}

const FILTER_OPTIONS: Array<{ id: MediaBrowserFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "success", label: "成功" },
  { id: "failed", label: "失败" },
];

function StatusIcon({ status }: { status?: MediaBrowserItemStatus }) {
  if (status === "success") {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />;
  }

  if (status === "failed") {
    return <XCircle className="h-4 w-4 shrink-0 text-destructive" />;
  }

  if (status === "processing") {
    return <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-primary" />;
  }

  return null;
}

function MediaBrowserListItem({ item }: { item: MediaBrowserItem }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "group flex w-full items-stretch rounded-quiet transition-all select-none",
            item.active
              ? "bg-surface-floating shadow-[0_18px_36px_rgba(0,0,0,0.08)] ring-1 ring-foreground/10"
              : "bg-transparent hover:bg-surface-floating/78",
          )}
        >
          {item.selectionControl && <div className="flex shrink-0 items-center px-4 py-4">{item.selectionControl}</div>}
          <button
            type="button"
            onClick={item.onClick}
            className={cn(
              "flex min-w-0 flex-1 items-center justify-between gap-3 border-0 bg-transparent text-left outline-none",
              item.selectionControl ? "py-4 pr-4" : "px-4 py-4",
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold tracking-tight text-foreground">{item.title}</div>
              {item.subtitle && <div className="mt-1 truncate text-[13px] text-muted-foreground">{item.subtitle}</div>}
              {item.errorText && <div className="mt-1.5 truncate text-xs text-destructive">{item.errorText}</div>}
            </div>
            <StatusIcon status={item.status} />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>{item.menuContent}</ContextMenuContent>
    </ContextMenu>
  );
}

export function MediaBrowserList({
  items,
  filter,
  onFilterChange,
  emptyMessage,
  emptyContent,
  headerLeading,
  headerTrailing,
  title,
  stats = [],
}: MediaBrowserListProps) {
  const visibleItems = items.filter((item) => {
    if (filter === "all") {
      return true;
    }

    return item.status === filter;
  });

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-6 pt-6 pb-4">
        {title && (
          <div className="mb-5">
            <h2 className="text-2xl font-extrabold tracking-tight text-foreground">{title}</h2>
            {stats.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                {stats.map((stat) => (
                  <div key={`${stat.label}-${stat.value}`} className="flex items-center gap-2">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full bg-muted-foreground/30",
                        stat.tone === "positive" && "bg-emerald-500",
                        stat.tone === "negative" && "bg-destructive",
                      )}
                    />
                    <span>
                      {stat.label}: <strong className="font-numeric font-bold text-foreground">{stat.value}</strong>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className={cn("flex items-center gap-3", headerLeading ? "justify-between" : "justify-end")}>
          {headerLeading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">{headerLeading}</div>
          )}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-quiet-sm bg-surface-low p-1">
              {FILTER_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={cn(
                    "rounded-quiet-sm px-2.5 py-1 text-xs transition-colors",
                    filter === option.id
                      ? "bg-surface-floating text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => onFilterChange(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {headerTrailing}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="space-y-2 px-4 pb-28">
            {visibleItems.length === 0 ? (
              <div className="flex min-h-40 flex-col items-center justify-center px-4 text-center">
                {emptyContent || <span className="text-xs text-muted-foreground opacity-70">{emptyMessage}</span>}
              </div>
            ) : (
              visibleItems.map((item) => <MediaBrowserListItem key={item.id} item={item} />)
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
