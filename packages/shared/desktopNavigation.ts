export type DesktopRouteId = "overview" | "workbench" | "tools" | "library" | "settings" | "logs" | "about";

export interface DesktopRouteDefinition {
  id: DesktopRouteId;
  label: string;
  path: string;
  group: "primary" | "system";
}

export const DESKTOP_ROUTE_DEFINITIONS: DesktopRouteDefinition[] = [
  { id: "overview", label: "概览", path: "/overview", group: "primary" },
  { id: "workbench", label: "工作台", path: "/workbench", group: "primary" },
  { id: "tools", label: "工具", path: "/tools", group: "primary" },
  { id: "library", label: "媒体库", path: "/library", group: "primary" },
  { id: "settings", label: "设置", path: "/settings", group: "system" },
  { id: "logs", label: "日志", path: "/logs", group: "system" },
  { id: "about", label: "关于", path: "/about", group: "system" },
];

export const PRIMARY_DESKTOP_ROUTES = DESKTOP_ROUTE_DEFINITIONS.filter((route) => route.group === "primary");
export const SYSTEM_DESKTOP_ROUTES = DESKTOP_ROUTE_DEFINITIONS.filter((route) => route.group === "system");
