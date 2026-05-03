import { Toaster } from "@mdcz/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";

import { queryClient } from "./lib/queryClient";
import {
  AboutPage,
  BrowserPage,
  LibraryDetailPage,
  LibraryPage,
  LogsPage,
  MediaRootsPage,
  OverviewPage,
  SettingsPage,
  SetupPage,
  TaskDetailPage,
  ToolsPage,
  WorkbenchPage,
} from "./routes";
import { RootLayout } from "./routes/layout";

const rootRoute = createRootRoute({
  component: () => (
    <RootLayout>
      <Outlet />
    </RootLayout>
  ),
});

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: OverviewPage });
const overviewRoute = createRoute({ getParentRoute: () => rootRoute, path: "/overview", component: OverviewPage });
const workbenchRoute = createRoute({ getParentRoute: () => rootRoute, path: "/workbench", component: WorkbenchPage });
const setupRoute = createRoute({ getParentRoute: () => rootRoute, path: "/setup", component: SetupPage });
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: () => null });
const mediaRootsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/media-roots",
  component: MediaRootsPage,
});
const browserRoute = createRoute({ getParentRoute: () => rootRoute, path: "/browser", component: BrowserPage });
const libraryRoute = createRoute({ getParentRoute: () => rootRoute, path: "/library", component: LibraryPage });
const libraryDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/library/$entryId",
  component: LibraryDetailPage,
});
const logsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/logs", component: LogsPage });
const toolsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/tools", component: ToolsPage });
const aboutRoute = createRoute({ getParentRoute: () => rootRoute, path: "/about", component: AboutPage });
const taskDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tasks/$taskId",
  component: TaskDetailPage,
});
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage });

const routeTree = rootRoute.addChildren([
  indexRoute,
  overviewRoute,
  workbenchRoute,
  setupRoute,
  loginRoute,
  mediaRootsRoute,
  browserRoute,
  libraryRoute,
  libraryDetailRoute,
  logsRoute,
  toolsRoute,
  aboutRoute,
  taskDetailRoute,
  settingsRoute,
]);
const router = createRouter({ routeTree });

export const AppRouter = () => (
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
    <Toaster richColors position="top-right" />
  </QueryClientProvider>
);
