import type { LogEntryDto } from "@mdcz/shared/serverDtos";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@mdcz/ui";
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
  total,
  query,
  kind,
  level,
  autoScroll,
  emptyText,
  endRef,
  error,
  formatDate,
  link,
  onAutoScrollChange,
  onClearSearch,
  onClearRuntime,
  onKindChange,
  onLevelChange,
  onQueryChange,
  onRefresh,
}: LogsPanelViewProps) => (
  <Card>
    <CardHeader>
      <CardTitle>任务事件</CardTitle>
      <CardDescription>聚合任务事件和 server/runtime 运行日志，保留桌面等级筛选与搜索体验。</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {error}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto_auto_auto] lg:items-center">
        <Input
          aria-label="搜索日志内容"
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索日志内容..."
          value={query}
        />
        <select
          aria-label="日志来源"
          className="h-10 rounded-quiet border border-border bg-surface-low px-3 text-sm text-foreground"
          value={kind}
          onChange={(event) => onKindChange(event.target.value as LogsKindFilter)}
        >
          <option value="all">全部来源</option>
          <option value="task">任务事件</option>
          <option value="runtime">运行时日志</option>
        </select>
        <select
          aria-label="日志等级"
          className="h-10 rounded-quiet border border-border bg-surface-low px-3 text-sm text-foreground"
          value={level}
          onChange={(event) => onLevelChange(event.target.value as LogsLevelFilter)}
        >
          <option value="all">全部等级</option>
          <option value="OK">OK</option>
          <option value="WARN">WARN</option>
          <option value="ERR">ERR</option>
          <option value="REQ">REQ</option>
          <option value="INFO">INFO</option>
        </select>
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <input
            checked={autoScroll}
            className="h-4 w-4 rounded border-border bg-surface-low text-primary focus-visible:ring-2 focus-visible:ring-ring"
            type="checkbox"
            onChange={(event) => onAutoScrollChange(event.target.checked)}
          />
          <span>自动滚动</span>
        </label>
        <Button variant="secondary" onClick={onRefresh}>
          刷新
        </Button>
        <Button disabled={!query} variant="secondary" onClick={onClearSearch}>
          清空搜索
        </Button>
        {onClearRuntime ? (
          <Button variant="secondary" onClick={onClearRuntime}>
            清空运行日志
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {link}
        <span className="text-sm text-muted-foreground">
          {logs.length} / {total} 条
        </span>
      </div>
      <LogsListView emptyText={emptyText} endRef={endRef} formatDate={formatDate} logs={logs} />
    </CardContent>
  </Card>
);
