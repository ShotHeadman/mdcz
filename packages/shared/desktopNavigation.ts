export type DesktopRouteId =
  | "overview"
  | "workbench"
  | "pending"
  | "tools"
  | "library"
  | "libraries"
  | "settings"
  | "logs"
  | "about";

export interface DesktopRouteDefinition {
  id: DesktopRouteId;
  path: string;
  group: "primary" | "system";
}

export const DESKTOP_ROUTE_DEFINITIONS: DesktopRouteDefinition[] = [
  { id: "overview", path: "/overview", group: "primary" },
  { id: "workbench", path: "/workbench", group: "primary" },
  { id: "pending", path: "/pending", group: "primary" },
  { id: "library", path: "/library", group: "primary" },
  { id: "libraries", path: "/libraries", group: "primary" },
  { id: "tools", path: "/tools", group: "primary" },
  { id: "settings", path: "/settings", group: "system" },
  { id: "logs", path: "/logs", group: "system" },
  { id: "about", path: "/about", group: "system" },
];

export const PRIMARY_DESKTOP_ROUTES = DESKTOP_ROUTE_DEFINITIONS.filter((route) => route.group === "primary");
export const SYSTEM_DESKTOP_ROUTES = DESKTOP_ROUTE_DEFINITIONS.filter((route) => route.group === "system");
