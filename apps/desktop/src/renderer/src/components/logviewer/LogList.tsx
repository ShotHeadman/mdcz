import { useVirtualizer } from "@tanstack/react-virtual";
import { CheckCircle2, CircleX, FileText, Globe2, Info, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import type { RuntimeLog } from "@/store/logStore";
import {
  getVisualLogLevel,
  getVisualLogLevelLabel,
  stringifyRuntimeLogMessage,
  type VisualLogLevel,
} from "./logFormat";

export interface LogListProps {
  items: RuntimeLog[];
  autoScroll: boolean;
}

function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("zh-CN", {
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
        label: getVisualLogLevelLabel(level),
        Icon: CheckCircle2,
        className: "text-emerald-600 dark:text-emerald-400",
      };
    case "warn":
      return {
        label: getVisualLogLevelLabel(level),
        Icon: TriangleAlert,
        className: "text-amber-600 dark:text-amber-400",
      };
    case "error":
      return {
        label: getVisualLogLevelLabel(level),
        Icon: CircleX,
        className: "text-rose-600 dark:text-rose-400",
      };
    case "request":
      return {
        label: getVisualLogLevelLabel(level),
        Icon: Globe2,
        className: "text-sky-600 dark:text-sky-400",
      };
    default:
      return {
        label: getVisualLogLevelLabel(level),
        Icon: Info,
        className: "text-sky-600 dark:text-sky-400",
      };
  }
}

export function LogList({ items, autoScroll }: LogListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const messages = useMemo(() => items.map((item) => stringifyRuntimeLogMessage(item.message)), [items]);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 42,
    getItemKey: (index) => items[index]?.id ?? index,
    overscan: 10,
    useAnimationFrameWithResizeObserver: true,
  });

  useEffect(() => {
    if (!autoScroll || items.length === 0 || !scrollRef.current) {
      return;
    }

    virtualizer.scrollToIndex(items.length - 1, { align: "end" });
  }, [autoScroll, items.length, virtualizer]);

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground/70">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-low text-muted-foreground/75">
          <FileText className="h-6 w-6 stroke-[1.75]" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground/80">暂无相关日志内容</p>
          <p className="text-xs text-muted-foreground">调整筛选条件后再试，或等待新的运行日志写入。</p>
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
        contain: "strict",
      }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const log = items[virtualRow.index];
          const message = messages[virtualRow.index] ?? "";
          const presentation = getLevelPresentation(getVisualLogLevel(log));

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "auto",
                minHeight: "36px",
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className="px-1"
            >
              <div className="rounded-[var(--radius-quiet-sm)] px-3 py-2 transition-colors hover:bg-surface-low/85">
                <div className="grid grid-cols-[64px_80px_minmax(0,1fr)] items-start gap-3 sm:grid-cols-[74px_92px_minmax(0,1fr)] sm:gap-4">
                  <span className="pt-0.5 font-numeric text-[11px] text-muted-foreground sm:text-xs">
                    {formatTimestamp(log.timestamp)}
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
                  <div className="min-h-5 break-words whitespace-pre-wrap leading-6 text-foreground">{message}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
