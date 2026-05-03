import type { LibraryEntryDto, ScanTaskDto, TaskKind } from "@mdcz/shared";
import type { AnchorHTMLAttributes, ReactNode } from "react";

import { buildHref } from "../routeHelpers";
import { Badge } from "../ui";

type AppLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  to: string;
  search?: Record<string, string | undefined>;
};

export const AppLink = ({ to, search, className, children, ...props }: AppLinkProps) => (
  <a className={className} href={buildHref(to, search)} {...props}>
    {children}
  </a>
);

export const ErrorBanner = ({ children }: { children: ReactNode }) => (
  <div className="rounded-quiet border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
    {children}
  </div>
);

export const Notice = ({ children }: { children: ReactNode }) => (
  <div className="rounded-quiet border border-border/60 bg-surface-low px-4 py-3 text-sm text-muted-foreground">
    {children}
  </div>
);

export const formatDate = (value: string | null | undefined): string =>
  value ? new Date(value).toLocaleString() : "—";

export const formatBytes = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

export const scanStatusLabels: Record<ScanTaskDto["status"], string> = {
  queued: "排队中",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  paused: "已暂停",
  stopping: "停止中",
};

export const taskKindLabels: Record<TaskKind, string> = {
  maintenance: "维护",
  scan: "扫描",
  scrape: "刮削",
};

export const LibraryEntryRow = ({ entry }: { entry: LibraryEntryDto }) => (
  <div className="grid gap-2 border-t border-border/40 px-4 py-3 first:border-t-0 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
    <div className="min-w-0">
      <p className="truncate font-medium text-foreground">{entry.title || entry.fileName}</p>
      <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
        {entry.rootDisplayName}
        {entry.directory ? ` / ${entry.directory}` : ""}
      </p>
      {entry.available === false && <p className="mt-1 text-xs text-destructive">文件已移动或删除</p>}
    </div>
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground lg:justify-end">
      <Badge>{formatBytes(entry.size)}</Badge>
      <span className="font-mono">{formatDate(entry.indexedAt)}</span>
      <AppLink
        className="font-medium text-foreground underline-offset-4 hover:underline"
        to={`/library/${encodeURIComponent(entry.id)}`}
      >
        详情
      </AppLink>
      {entry.taskId && (
        <AppLink
          className="font-medium text-foreground underline-offset-4 hover:underline"
          to={`/tasks/${entry.taskId}`}
        >
          任务
        </AppLink>
      )}
      <AppLink
        className="font-medium text-foreground underline-offset-4 hover:underline"
        to="/browser"
        search={{ rootId: entry.rootId, path: entry.directory }}
      >
        浏览目录
      </AppLink>
    </div>
  </div>
);
