import type { LogEntryDto } from "@mdcz/shared/serverDtos";
import { Badge } from "@mdcz/ui";
import type { RefObject } from "react";

export interface LogsListViewProps {
  logs: LogEntryDto[];
  emptyText?: string;
  endRef?: RefObject<HTMLDivElement | null>;
  formatDate: (value: string) => string;
}

const badgeVariant = (level: string | undefined): "default" | "destructive" | "secondary" => {
  if (level === "ERR") return "destructive";
  if (level === "WARN" || level === "REQ") return "secondary";
  return "default";
};

export const LogsListView = ({ logs, emptyText = "暂无日志。", endRef, formatDate }: LogsListViewProps) => (
  <div className="grid h-full overflow-auto rounded-[calc(var(--radius-quiet-xl)-0.35rem)] bg-surface-low/40">
    {logs.map((log) => (
      <div className="grid gap-1 border-t border-border/40 px-4 py-3 first:border-t-0" key={log.id}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={badgeVariant(log.level)}>{log.level ?? "INFO"}</Badge>
            <Badge>{log.source}</Badge>
            <Badge variant="secondary">{log.type}</Badge>
            <span className="font-mono text-xs text-muted-foreground">{log.taskId}</span>
          </div>
          <span className="font-mono text-xs text-muted-foreground">{formatDate(log.createdAt)}</span>
        </div>
        <p className="text-sm text-muted-foreground">{log.message}</p>
      </div>
    ))}
    {endRef && <div ref={endRef} />}
    {logs.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted-foreground">{emptyText}</div>}
  </div>
);
