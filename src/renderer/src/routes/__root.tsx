import { createRootRoute, Outlet } from "@tanstack/react-router";
import CrashFallback from "../components/CrashFallback";
import { ErrorBoundary } from "../components/ErrorBoundary";
import Layout from "../components/Layout";
import { ShortcutHandler } from "../components/ShortcutHandler";

const RootComponent = () => {
  return (
    <ErrorBoundary fallbackRender={({ error, reset }) => <CrashFallback error={error} onRetry={reset} />}>
      <Layout>
        <ShortcutHandler />
        <Outlet />
      </Layout>
    </ErrorBoundary>
  );
};

export const Route = createRootRoute({
  component: RootComponent,
  errorComponent: ({ error, reset }) => <CrashFallback error={error} onRetry={reset} />,
});
