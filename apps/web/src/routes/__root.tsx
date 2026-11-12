import { TOOL_DEFINITIONS, type ToolId } from "@mdcz/shared/toolCatalog";
import { selectUnseenCount, useBriefJobFollower, useBriefStore } from "@mdcz/views/brief";
import { useT } from "@mdcz/views/i18n";
import {
  AppShell,
  CrashFallback,
  ErrorBoundary,
  PRIMARY_SHELL_NAV,
  type ShellLinkProps,
  SYSTEM_SHELL_NAV,
} from "@mdcz/views/shell";
import { ToolsRouteView } from "@mdcz/views/tools";
import { useQuery } from "@tanstack/react-query";
import { createRootRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useWebBriefPort } from "../adapters/briefPort";
import { api } from "../client";
import { LoginPage } from "../components/auth/LoginPage";
import { DesktopChrome, DesktopTitleBar } from "../components/DesktopChrome";
import { desktop } from "../desktop";
import { useWebTaskSync } from "../hooks/useWebTaskSync";
import { queryKeys } from "../lib/queryKeys";
import { ToolDetail } from "./tools/ToolDetail";
import { parseToolsSearch } from "./toolsController";

const PUBLIC_PATHS = new Set(["/setup", "/login"]);

const ShellLink = ({ to, className, onFocus, onMouseEnter, children }: ShellLinkProps) => (
  <Link className={className} to={to} preload="intent" onFocus={onFocus} onMouseEnter={onMouseEnter}>
    {children}
  </Link>
);

export const RootLayout = ({ children }: { children: ReactNode }) => {
  const t = useT();
  const navigate = useNavigate();
  // The rendered route, not the one being navigated to: right after a redirect to /setup the outlet still shows the
  // previous page, which must not mount and query the API without a session.
  const pathname = useRouterState({ select: (state) => (state.resolvedLocation ?? state.location).pathname });
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
  const configQ = useQuery({ queryKey: queryKeys.config.current, queryFn: () => api.config.read() });
  // While Brief is off its sidebar item, page and badge do not exist.
  const briefEnabled = configQ.data?.llm.brief === true;
  const briefPort = useWebBriefPort();
  useBriefJobFollower(briefEnabled ? briefPort : null);
  const unseenBriefJobs = useBriefStore(selectUnseenCount);
  const [hasVisitedTools, setHasVisitedTools] = useState(pathname === "/tools");
  const isToolsRoute = pathname === "/tools";
  const toolsSearch = useRouterState({
    select: (state) => (state.location.pathname === "/tools" ? parseToolsSearch(state.location.search) : {}),
    structuralSharing: true,
  });
  const toolRequest =
    toolsSearch.tool && toolsSearch.open ? { toolId: toolsSearch.tool, key: toolsSearch.open } : undefined;

  useEffect(() => {
    if (isToolsRoute) {
      setHasVisitedTools(true);
    }
  }, [isToolsRoute]);

  return (
    <AppShell
      currentPath={pathname}
      linkComponent={ShellLink}
      navBadges={{
        pending: pendingQ.data?.items.length,
        brief: pathname === "/brief" ? undefined : unseenBriefJobs,
      }}
      primaryNav={briefEnabled ? PRIMARY_SHELL_NAV : PRIMARY_SHELL_NAV.filter((item) => item.id !== "brief")}
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
          <ToolsRouteView
            tools={TOOL_DEFINITIONS}
            request={toolRequest}
            renderDetail={(toolId: ToolId) => (
              <ToolDetail
                toolId={toolId}
                prefill={
                  toolRequest?.toolId === toolId
                    ? { key: toolRequest.key, directory: toolsSearch.directory, mode: toolsSearch.mode }
                    : undefined
                }
              />
            )}
          />
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
