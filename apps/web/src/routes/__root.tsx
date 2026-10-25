import { TOOL_DEFINITIONS, type ToolId } from "@mdcz/shared/toolCatalog";
import { useT } from "@mdcz/views/i18n";
import { AppShell, CrashFallback, ErrorBoundary, type ShellLinkProps, SYSTEM_SHELL_NAV } from "@mdcz/views/shell";
import { ToolsRouteView } from "@mdcz/views/tools";
import { useQuery } from "@tanstack/react-query";
import { createRootRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { api } from "../client";
import { LoginPage } from "../components/auth/LoginPage";
import { DesktopChrome, DesktopTitleBar } from "../components/DesktopChrome";
import { desktop } from "../desktop";
import { useWebTaskSync } from "../hooks/useWebTaskSync";
import { queryKeys } from "../lib/queryKeys";
import { ToolDetail } from "./tools/ToolDetail";

const PUBLIC_PATHS = new Set(["/setup", "/login"]);

const ShellLink = ({ to, className, onFocus, onMouseEnter, children }: ShellLinkProps) => (
  <Link className={className} to={to} preload="intent" onFocus={onFocus} onMouseEnter={onMouseEnter}>
    {children}
  </Link>
);

export const RootLayout = ({ children }: { children: ReactNode }) => {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;
  const authQ = useQuery({ queryKey: queryKeys.auth.status, queryFn: () => api.auth.status() });
  const setupRequired = Boolean(authQ.data?.setupRequired);
  const authenticated = Boolean(authQ.data?.authenticated);

  useEffect(() => {
    if (authQ.isLoading || !authQ.data) {
      return;
    }

    if (setupRequired && pathname !== "/setup") {
      void navigate({ to: "/setup", replace: true });
      return;
    }

    if (!setupRequired && pathname === "/setup") {
      void navigate({ to: "/", replace: true });
    }
  }, [authQ.data, authQ.isLoading, navigate, pathname, setupRequired]);

  if (authQ.isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-surface-canvas text-sm text-muted-foreground">
        {t.common.loading}
      </div>
    );
  }

  if (setupRequired && pathname !== "/setup") {
    return null;
  }

  if (!setupRequired && pathname === "/setup") {
    return null;
  }

  if (!setupRequired && !authenticated && !PUBLIC_PATHS.has(pathname)) {
    return <LoginPage nextPath={pathname} />;
  }

  if (PUBLIC_PATHS.has(pathname)) {
    return <>{children}</>;
  }

  return <AuthenticatedShell pathname={pathname}>{children}</AuthenticatedShell>;
};

const AuthenticatedShell = ({ children, pathname }: { children: ReactNode; pathname: string }) => {
  useWebTaskSync();
  const pendingQ = useQuery({ queryKey: queryKeys.pending.all, queryFn: () => api.pending.list() });
  // The logs panel and custom title bar are desktop settings; the browser has neither.
  const configQ = useQuery({
    queryKey: queryKeys.config.current,
    queryFn: () => api.config.read(),
    enabled: Boolean(desktop),
  });
  const [hasVisitedTools, setHasVisitedTools] = useState(pathname === "/tools");
  const isToolsRoute = pathname === "/tools";
  const ui = desktop ? configQ.data?.ui : undefined;

  useEffect(() => {
    if (isToolsRoute) {
      setHasVisitedTools(true);
    }
  }, [isToolsRoute]);

  return (
    <AppShell
      currentPath={pathname}
      linkComponent={ShellLink}
      navBadges={{ pending: pendingQ.data?.items.length }}
      systemNav={
        ui?.showLogsPanel === false ? SYSTEM_SHELL_NAV.filter((item) => item.to !== "/logs") : SYSTEM_SHELL_NAV
      }
      titlebar={ui?.useCustomTitleBar ? <DesktopTitleBar /> : null}
    >
      {desktop ? <DesktopChrome desktop={desktop} /> : null}
      {children}
      {hasVisitedTools || isToolsRoute ? (
        <div className="h-full w-full" style={{ display: isToolsRoute ? "block" : "none" }}>
          <ToolsRouteView tools={TOOL_DEFINITIONS} renderDetail={(toolId: ToolId) => <ToolDetail toolId={toolId} />} />
        </div>
      ) : null}
    </AppShell>
  );
};

export const Route = createRootRoute({
  component: () => (
    <ErrorBoundary>
      <RootLayout>
        <Outlet />
      </RootLayout>
    </ErrorBoundary>
  ),
  errorComponent: ({ error, reset }) => <CrashFallback error={error} onRetry={reset} />,
});
