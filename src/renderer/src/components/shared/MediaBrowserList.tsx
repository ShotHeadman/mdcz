import { CheckCircle2, LoaderCircle, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
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

interface MediaBrowserListProps {
  items: MediaBrowserItem[];
  filter: MediaBrowserFilter;
  onFilterChange: (filter: MediaBrowserFilter) => void;
  emptyMessage?: string;
  emptyContent?: ReactNode;
  headerLeading?: ReactNode;
  headerTrailing?: ReactNode;
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
            "group flex w-full items-stretch rounded-xl border transition-all select-none",
            item.active ? "border-primary/60 bg-primary/5" : "border-transparent hover:border-border hover:bg-muted/30",
          )}
        >
          {item.selectionControl && <div className="flex shrink-0 items-center px-3 py-3">{item.selectionControl}</div>}
          <button
            type="button"
            onClick={item.onClick}
            className={cn(
              "flex min-w-0 flex-1 items-center justify-between gap-3 border-0 bg-transparent text-left outline-none",
              item.selectionControl ? "py-3 pr-3" : "px-3 py-3",
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 font-semibold">{item.title}</span>
                {item.subtitle && (
                  <span className="min-w-0 shrink truncate text-sm text-muted-foreground">{item.subtitle}</span>
                )}
              </div>
              {item.errorText && <div className="mt-1 truncate text-xs text-destructive">{item.errorText}</div>}
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
}: MediaBrowserListProps) {
  const visibleItems = items.filter((item) => {
    if (filter === "all") {
      return true;
    }

    return item.status === filter;
  });

  return (
    <Card className="flex h-full flex-col gap-2 rounded-none border-0 bg-transparent pt-4 shadow-none">
      <CardHeader className="shrink-0 border-b px-4 gap-0 pb-3!">
        <div className={cn("flex items-center", headerLeading ? "justify-between" : "justify-end")}>
          {headerLeading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">{headerLeading}</div>
          )}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-1">
              {FILTER_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs transition-colors",
                    filter === option.id
                      ? "bg-background text-foreground shadow-sm"
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
      </CardHeader>
      <CardContent className="flex-1 min-h-0 overflow-hidden p-0">
        <ScrollArea className="h-full">
          <div className="space-y-2 p-3">
            {visibleItems.length === 0 ? (
              <div className="flex min-h-40 flex-col items-center justify-center text-center">
                {emptyContent || <span className="text-xs text-muted-foreground opacity-70">{emptyMessage}</span>}
              </div>
            ) : (
              visibleItems.map((item) => <MediaBrowserListItem key={item.id} item={item} />)
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
