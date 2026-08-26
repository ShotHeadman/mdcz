import type { ScanTaskDto, TaskKind } from "@mdcz/shared";
import { Link } from "@tanstack/react-router";
import type { ComponentProps, ReactNode } from "react";

import { buildHref } from "./routeHelpers";

type AppLinkProps = Omit<ComponentProps<typeof Link>, "to" | "search"> & {
  to: string;
  search?: Record<string, string | undefined>;
};

export const AppLink = ({ to, search, className, children, ...props }: AppLinkProps) => (
  <Link className={className} to={buildHref(to, search)} {...props}>
    {children}
  </Link>
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
