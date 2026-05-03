import type { ScanTaskDto, TaskKind } from "@mdcz/shared";
import type { AnchorHTMLAttributes, ReactNode } from "react";

import { buildHref } from "./routeHelpers";

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
