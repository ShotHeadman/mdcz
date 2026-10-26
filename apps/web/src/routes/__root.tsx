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
      <div className="flex h-full items-center justify-center bg-surface-canvas text-sm text-muted-foreground">
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
  // The logs panel is a desktop setting; the browser has none.
  const configQ = useQuery({
    queryKey: queryKeys.config.current,
    queryFn: () => api.config.read(),
    enabled: Boolean(desktop),
  });
  const [hasVisitedTools, setHasVisitedTools] = useState(pathname === "/tools");
  const isToolsRoute = pathname === "/tools";

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
        desktop && configQ.data?.ui.showLogsPanel === false
          ? SYSTEM_SHELL_NAV.filter((item) => item.to !== "/logs")
          : SYSTEM_SHELL_NAV
      }
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

// The window keeps its frame until relaunch, so the title bar strip wraps every page from the first paint, loading and
// crash screens included.
const WindowFrame = ({ children }: { children: ReactNode }) =>
  desktop?.customTitleBar ? (
    <div className="flex h-full flex-col">
      <DesktopTitleBar />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  ) : (
    children
  );

export const Route = createRootRoute({
  component: () => (
    <WindowFrame>
      <ErrorBoundary>
        <RootLayout>
          <Outlet />
        </RootLayout>
      </ErrorBoundary>
    </WindowFrame>
  ),
  errorComponent: ({ error, reset }) => (
    <WindowFrame>
      <CrashFallback error={error} onRetry={reset} />
    </WindowFrame>
  ),
});
