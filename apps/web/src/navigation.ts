import { type DesktopRouteId, PRIMARY_DESKTOP_ROUTES, SYSTEM_DESKTOP_ROUTES } from "@mdcz/shared/desktopNavigation";
import type { LucideIcon } from "lucide-react";
import { Info, LayoutDashboard, PlaySquare, ScrollText, Settings, Wrench } from "lucide-react";

const routeIcons: Record<DesktopRouteId, LucideIcon> = {
  about: Info,
  logs: ScrollText,
  overview: LayoutDashboard,
  settings: Settings,
  tools: Wrench,
  workbench: PlaySquare,
};

export interface NavItem {
  icon: LucideIcon;
  label: string;
  to: string;
}

const toNavItem = (route: (typeof PRIMARY_DESKTOP_ROUTES)[number]): NavItem => ({
  icon: routeIcons[route.id],
  label: route.label,
  to: route.path,
});

export const PRIMARY_NAV: NavItem[] = PRIMARY_DESKTOP_ROUTES.map(toNavItem);
export const SYSTEM_NAV: NavItem[] = SYSTEM_DESKTOP_ROUTES.map(toNavItem);
export const NAV_ITEMS: NavItem[] = [...PRIMARY_NAV, ...SYSTEM_NAV];
