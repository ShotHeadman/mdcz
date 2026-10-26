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
