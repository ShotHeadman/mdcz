import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";

import { BrowserPage, MediaRootsPage, OverviewPage, RootLayout, SettingsPage, SetupPage, TasksPage } from "./routes";

const queryClient = new QueryClient();

const rootRoute = createRootRoute({
  component: () => (
    <RootLayout>
      <Outlet />
    </RootLayout>
  ),
});

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: OverviewPage });
const setupRoute = createRoute({ getParentRoute: () => rootRoute, path: "/setup", component: SetupPage });
const mediaRootsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/media-roots",
  component: MediaRootsPage,
});
const browserRoute = createRoute({ getParentRoute: () => rootRoute, path: "/browser", component: BrowserPage });
const tasksRoute = createRoute({ getParentRoute: () => rootRoute, path: "/tasks", component: TasksPage });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage });

const routeTree = rootRoute.addChildren([
  indexRoute,
  setupRoute,
  mediaRootsRoute,
  browserRoute,
  tasksRoute,
  settingsRoute,
]);
const router = createRouter({ routeTree });

export const AppRouter = () => (
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>
);
