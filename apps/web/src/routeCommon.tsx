import type { ScanTaskDto, TaskKind } from "@mdcz/shared";
import { getT } from "@mdcz/views/i18n";
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
  get queued() {
    return getT().web.taskStatus.queued;
  },
  get running() {
    return getT().web.taskStatus.running;
  },
  get completed() {
    return getT().web.taskStatus.completed;
  },
  get failed() {
    return getT().web.taskStatus.failed;
  },
  get paused() {
    return getT().web.taskStatus.paused;
  },
  get stopping() {
    return getT().web.taskStatus.stopping;
  },
};

export const taskKindLabels: Record<TaskKind, string> = {
  get maintenance() {
    return getT().web.taskType.maintenance;
  },
  get scan() {
    return getT().web.taskType.scan;
  },
  get scrape() {
    return getT().web.taskType.scrape;
  },
};
