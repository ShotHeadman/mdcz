import { getVisualLogLevel } from "@mdcz/shared/logFormatting";
import type { LogEntryDto } from "@mdcz/shared/serverDtos";
import { cn } from "@mdcz/ui";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CheckCircle2, CircleX, FileText, Globe2, Info, TriangleAlert } from "lucide-react";
import { useEffect, useRef } from "react";

export interface LogsListViewProps {
  autoScroll?: boolean;
  logs: LogEntryDto[];
  emptyText?: string;
}

type VisualLogLevel = ReturnType<typeof getVisualLogLevel>;

function formatTimestamp(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return timestamp;
  }
}

function getLevelPresentation(level: VisualLogLevel) {
  switch (level) {
    case "ok":
      return {
        label: "OK",
        Icon: CheckCircle2,
        className: "text-emerald-600 dark:text-emerald-400",
      };
    case "warn":
      return {
        label: "WARN",
        Icon: TriangleAlert,
        className: "text-amber-600 dark:text-amber-400",
      };
    case "error":
      return {
        label: "ERR",
        Icon: CircleX,
        className: "text-rose-600 dark:text-rose-400",
      };
    case "request":
      return {
        label: "REQ",
        Icon: Globe2,
        className: "text-sky-600 dark:text-sky-400",
      };
    default:
      return {
        label: "INFO",
        Icon: Info,
        className: "text-sky-600 dark:text-sky-400",
      };
  }
}

export const LogsListView = ({ autoScroll = true, logs, emptyText = "暂无日志。" }: LogsListViewProps) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const logCount = logs.length;
  const rowVirtualizer = useVirtualizer({
    count: logCount,
    estimateSize: () => 44,
    getItemKey: (index) => logs[index]?.id ?? index,
    getScrollElement: () => scrollRef.current,
    overscan: 16,
  });

  useEffect(() => {
    if (!autoScroll || logCount === 0) {
      return;
    }

    rowVirtualizer.scrollToIndex(logCount - 1, { align: "end" });
  }, [autoScroll, logCount, rowVirtualizer]);

  if (logCount === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground/70">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-low text-muted-foreground/75">
          <FileText className="h-6 w-6 stroke-[1.75]" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground/80">暂无相关日志内容</p>
          <p className="text-xs text-muted-foreground">{emptyText}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-auto px-2 pb-2 font-mono text-[12.5px] sm:px-3 sm:pb-3"
      style={{
        overflowAnchor: "none",
      }}
    >
      <div
        className="relative w-full"
        style={{
          height: rowVirtualizer.getTotalSize(),
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const index = virtualRow.index;
          const log = logs[index];
          if (!log) return null;
          const presentation = getLevelPresentation(getVisualLogLevel(log));

          return (
            <div
              key={virtualRow.key}
              ref={rowVirtualizer.measureElement}
              data-index={index}
              className="absolute left-0 top-0 w-full px-1"
              style={{
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div className="rounded-[var(--radius-quiet-sm)] px-3 py-2 transition-colors hover:bg-surface-low/85">
                <div className="grid grid-cols-[64px_80px_minmax(0,1fr)] items-start gap-3 sm:grid-cols-[74px_92px_minmax(0,1fr)] sm:gap-4">
                  <span className="pt-0.5 font-numeric text-[11px] text-muted-foreground sm:text-xs">
                    {formatTimestamp(log.createdAt)}
                  </span>
                  <span
                    className={cn(
                      "flex items-center gap-1.5 pt-0.5 text-[11px] font-semibold uppercase tracking-[0.16em] sm:text-xs",
                      presentation.className,
                    )}
                  >
                    <presentation.Icon className="h-3.5 w-3.5 shrink-0 stroke-[2.2]" />
                    <span>{presentation.label}</span>
                  </span>
                  <div className="min-h-5 break-words whitespace-pre-wrap leading-6 text-foreground">{log.message}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
