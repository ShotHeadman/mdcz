/* eslint-disable */

// @ts-nocheck

// Static TanStack Router file-route tree for WebUI.
// Keep this aligned with apps/web/src/routes/* until router generation is wired into the Web build.

import { Route as rootRouteImport } from "./routes/__root";
import { Route as AboutRouteImport } from "./routes/about";
import { Route as BrowserRouteImport } from "./routes/browser";
import { Route as IndexRouteImport } from "./routes/index";
import { Route as LibraryRouteImport } from "./routes/library";
import { Route as LoginRouteImport } from "./routes/login";
import { Route as LogsRouteImport } from "./routes/logs";
import { Route as MediaRootsRouteImport } from "./routes/media-roots";
import { Route as OverviewRouteImport } from "./routes/overview";
import { Route as ScrapeResultIdRouteImport } from "./routes/scrape.$resultId";
import { Route as SettingsRouteImport } from "./routes/settings";
import { Route as SetupRouteImport } from "./routes/setup";
import { Route as ToolsRouteImport } from "./routes/tools";
import { Route as WorkbenchRouteImport } from "./routes/workbench";

const IndexRoute = IndexRouteImport.update({
  id: "/",
  path: "/",
  getParentRoute: () => rootRouteImport,
} as any);
const AboutRoute = AboutRouteImport.update({
  id: "/about",
  path: "/about",
  getParentRoute: () => rootRouteImport,
} as any);
const BrowserRoute = BrowserRouteImport.update({
  id: "/browser",
  path: "/browser",
  getParentRoute: () => rootRouteImport,
} as any);
const LibraryRoute = LibraryRouteImport.update({
  id: "/library",
  path: "/library",
  getParentRoute: () => rootRouteImport,
} as any);
const LoginRoute = LoginRouteImport.update({
  id: "/login",
  path: "/login",
  getParentRoute: () => rootRouteImport,
} as any);
const LogsRoute = LogsRouteImport.update({
  id: "/logs",
  path: "/logs",
  getParentRoute: () => rootRouteImport,
} as any);
const MediaRootsRoute = MediaRootsRouteImport.update({
  id: "/media-roots",
  path: "/media-roots",
  getParentRoute: () => rootRouteImport,
} as any);
const OverviewRoute = OverviewRouteImport.update({
  id: "/overview",
  path: "/overview",
  getParentRoute: () => rootRouteImport,
} as any);
const ScrapeResultIdRoute = ScrapeResultIdRouteImport.update({
  id: "/scrape/$resultId",
  path: "/scrape/$resultId",
  getParentRoute: () => rootRouteImport,
} as any);
const SettingsRoute = SettingsRouteImport.update({
  id: "/settings",
  path: "/settings",
  getParentRoute: () => rootRouteImport,
} as any);
const SetupRoute = SetupRouteImport.update({
  id: "/setup",
  path: "/setup",
  getParentRoute: () => rootRouteImport,
} as any);
const ToolsRoute = ToolsRouteImport.update({
  id: "/tools",
  path: "/tools",
  getParentRoute: () => rootRouteImport,
} as any);
const WorkbenchRoute = WorkbenchRouteImport.update({
  id: "/workbench",
  path: "/workbench",
  getParentRoute: () => rootRouteImport,
} as any);
export interface RootRouteChildren {
  IndexRoute: typeof IndexRoute;
  AboutRoute: typeof AboutRoute;
  BrowserRoute: typeof BrowserRoute;
  LibraryRoute: typeof LibraryRoute;
  LoginRoute: typeof LoginRoute;
  LogsRoute: typeof LogsRoute;
  MediaRootsRoute: typeof MediaRootsRoute;
  OverviewRoute: typeof OverviewRoute;
  ScrapeResultIdRoute: typeof ScrapeResultIdRoute;
  SettingsRoute: typeof SettingsRoute;
  SetupRoute: typeof SetupRoute;
  ToolsRoute: typeof ToolsRoute;
  WorkbenchRoute: typeof WorkbenchRoute;
}

export interface FileRoutesByFullPath {
  "/": typeof IndexRoute;
  "/about": typeof AboutRoute;
  "/browser": typeof BrowserRoute;
  "/library": typeof LibraryRoute;
  "/login": typeof LoginRoute;
  "/logs": typeof LogsRoute;
  "/media-roots": typeof MediaRootsRoute;
  "/overview": typeof OverviewRoute;
  "/scrape/$resultId": typeof ScrapeResultIdRoute;
  "/settings": typeof SettingsRoute;
  "/setup": typeof SetupRoute;
  "/tools": typeof ToolsRoute;
  "/workbench": typeof WorkbenchRoute;
}

export interface FileRoutesByTo {
  "/": typeof IndexRoute;
  "/about": typeof AboutRoute;
  "/browser": typeof BrowserRoute;
  "/library": typeof LibraryRoute;
  "/login": typeof LoginRoute;
  "/logs": typeof LogsRoute;
  "/media-roots": typeof MediaRootsRoute;
  "/overview": typeof OverviewRoute;
  "/scrape/$resultId": typeof ScrapeResultIdRoute;
  "/settings": typeof SettingsRoute;
  "/setup": typeof SetupRoute;
  "/tools": typeof ToolsRoute;
  "/workbench": typeof WorkbenchRoute;
}

export interface FileRoutesById {
  __root__: typeof rootRouteImport;
  "/": typeof IndexRoute;
  "/about": typeof AboutRoute;
  "/browser": typeof BrowserRoute;
  "/library": typeof LibraryRoute;
  "/login": typeof LoginRoute;
  "/logs": typeof LogsRoute;
  "/media-roots": typeof MediaRootsRoute;
  "/overview": typeof OverviewRoute;
  "/scrape/$resultId": typeof ScrapeResultIdRoute;
  "/settings": typeof SettingsRoute;
  "/setup": typeof SetupRoute;
  "/tools": typeof ToolsRoute;
  "/workbench": typeof WorkbenchRoute;
}

export interface FileRouteTypes {
  fileRoutesByFullPath: FileRoutesByFullPath;
  fullPaths:
    | "/"
    | "/about"
    | "/browser"
    | "/library"
    | "/login"
    | "/logs"
    | "/media-roots"
    | "/overview"
    | "/scrape/$resultId"
    | "/settings"
    | "/setup"
    | "/tools"
    | "/workbench";
  fileRoutesByTo: FileRoutesByTo;
  to:
    | "/"
    | "/about"
    | "/browser"
    | "/library"
    | "/login"
    | "/logs"
    | "/media-roots"
    | "/overview"
    | "/scrape/$resultId"
    | "/settings"
    | "/setup"
    | "/tools"
    | "/workbench";
  id:
    | "__root__"
    | "/"
    | "/about"
    | "/browser"
    | "/library"
    | "/login"
    | "/logs"
    | "/media-roots"
    | "/overview"
    | "/scrape/$resultId"
    | "/settings"
    | "/setup"
    | "/tools"
    | "/workbench";
  fileRoutesById: FileRoutesById;
}

declare module "@tanstack/react-router" {
  interface FileRoutesByPath {
    "/": {
      id: "/";
      path: "/";
      fullPath: "/";
      preLoaderRoute: typeof IndexRouteImport;
      parentRoute: typeof rootRouteImport;
    };
    "/about": {
      id: "/about";
      path: "/about";
      fullPath: "/about";
      preLoaderRoute: typeof AboutRouteImport;
      parentRoute: typeof rootRouteImport;
    };
    "/browser": {
      id: "/browser";
      path: "/browser";
      fullPath: "/browser";
      preLoaderRoute: typeof BrowserRouteImport;
      parentRoute: typeof rootRouteImport;
    };
    "/library": {
      id: "/library";
      path: "/library";
      fullPath: "/library";
      preLoaderRoute: typeof LibraryRouteImport;
      parentRoute: typeof rootRouteImport;
    };
    "/login": {
      id: "/login";
      path: "/login";
      fullPath: "/login";
      preLoaderRoute: typeof LoginRouteImport;
      parentRoute: typeof rootRouteImport;
    };
    "/logs": {
      id: "/logs";
      path: "/logs";
      fullPath: "/logs";
      preLoaderRoute: typeof LogsRouteImport;
      parentRoute: typeof rootRouteImport;
    };
    "/media-roots": {
      id: "/media-roots";
      path: "/media-roots";
      fullPath: "/media-roots";
      preLoaderRoute: typeof MediaRootsRouteImport;
      parentRoute: typeof rootRouteImport;
    };
    "/overview": {
      id: "/overview";
      path: "/overview";
      fullPath: "/overview";
      preLoaderRoute: typeof OverviewRouteImport;
      parentRoute: typeof rootRouteImport;
    };
    "/scrape/$resultId": {
      id: "/scrape/$resultId";
      path: "/scrape/$resultId";
      fullPath: "/scrape/$resultId";
      preLoaderRoute: typeof ScrapeResultIdRouteImport;
      parentRoute: typeof rootRouteImport;
    };
    "/settings": {
      id: "/settings";
      path: "/settings";
      fullPath: "/settings";
      preLoaderRoute: typeof SettingsRouteImport;
      parentRoute: typeof rootRouteImport;
    };
    "/setup": {
      id: "/setup";
      path: "/setup";
      fullPath: "/setup";
      preLoaderRoute: typeof SetupRouteImport;
      parentRoute: typeof rootRouteImport;
    };
    "/tools": {
      id: "/tools";
      path: "/tools";
      fullPath: "/tools";
      preLoaderRoute: typeof ToolsRouteImport;
      parentRoute: typeof rootRouteImport;
    };
    "/workbench": {
      id: "/workbench";
      path: "/workbench";
      fullPath: "/workbench";
      preLoaderRoute: typeof WorkbenchRouteImport;
      parentRoute: typeof rootRouteImport;
    };
  }
}

const rootRouteChildren: RootRouteChildren = {
  IndexRoute,
  AboutRoute,
  BrowserRoute,
  LibraryRoute,
  LoginRoute,
  LogsRoute,
  MediaRootsRoute,
  OverviewRoute,
  ScrapeResultIdRoute,
  SettingsRoute,
  SetupRoute,
  ToolsRoute,
  WorkbenchRoute,
};

export const routeTree = rootRouteImport._addFileChildren(rootRouteChildren)._addFileTypes<FileRouteTypes>();
