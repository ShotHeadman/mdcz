import type { LogEntryDto } from "@mdcz/shared/serverDtos";
import { Button, cn, Input } from "@mdcz/ui";
import { ArrowDownToLine, Eraser, Search } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { LogsListView } from "./LogsListView";

export type LogsKindFilter = "all" | "task" | "runtime";
export type LogsLevelFilter = "all" | "OK" | "WARN" | "ERR" | "REQ" | "INFO";

export interface LogsPanelViewProps {
  logs: LogEntryDto[];
  total: number;
  query: string;
  kind: LogsKindFilter;
  level: LogsLevelFilter;
  autoScroll: boolean;
  emptyText: string;
  endRef?: RefObject<HTMLDivElement | null>;
  error?: ReactNode;
  formatDate: (value: string) => string;
  link?: ReactNode;
  onAutoScrollChange: (value: boolean) => void;
  onClearSearch: () => void;
  onClearRuntime?: () => void;
  onKindChange: (value: LogsKindFilter) => void;
  onLevelChange: (value: LogsLevelFilter) => void;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
}

export const LogsPanelView = ({
  logs,
  query,
  autoScroll,
  emptyText,
  endRef,
  error,
  formatDate,
  onAutoScrollChange,
  onClearRuntime,
  onQueryChange,
}: LogsPanelViewProps) => (
  <div className="flex h-full flex-col overflow-hidden">
    <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
      <div className="relative w-full min-w-0 sm:mr-auto sm:max-w-[360px]">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
        <Input
          aria-label="搜索日志内容"
          className="h-11 rounded-[var(--radius-quiet-capsule)] pl-11 pr-4 shadow-none"
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索日志内容..."
          value={query}
        />
      </div>

      <Button
        type="button"
        variant="secondary"
        className={cn(
          "h-11 gap-2 px-4",
          autoScroll &&
            "border-primary/15 bg-primary text-primary-foreground shadow-[0_16px_34px_-22px_rgba(15,23,42,0.65)] hover:bg-primary/92",
        )}
        onClick={() => onAutoScrollChange(!autoScroll)}
      >
        <ArrowDownToLine className={cn("h-4 w-4", !autoScroll && "opacity-60")} />
        <span className="text-sm font-medium">自动滚动</span>
      </Button>

      {onClearRuntime ? (
        <Button
          type="button"
          variant="secondary"
          className="h-11 gap-2 px-4 text-foreground hover:border-destructive/15 hover:bg-destructive/5 hover:text-destructive"
          onClick={onClearRuntime}
        >
          <Eraser className="h-4 w-4" />
          <span className="text-sm font-medium">清空</span>
        </Button>
      ) : null}
    </div>

    {error}
    <section className="flex min-h-0 flex-1 flex-col rounded-[var(--radius-quiet-xl)] border border-border/50 bg-surface-floating/96 p-1.5 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.42)] sm:p-2">
      <div className="min-h-0 flex-1">
        <LogsListView emptyText={emptyText} endRef={endRef} formatDate={formatDate} logs={logs} />
      </div>
    </section>
  </div>
);
