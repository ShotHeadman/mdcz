import {
  type DesktopRouteDefinition,
  type DesktopRouteId,
  PRIMARY_DESKTOP_ROUTES,
  SYSTEM_DESKTOP_ROUTES,
} from "@mdcz/shared/desktopNavigation";
import { Button, cn, NavButton, Separator, Tooltip, TooltipContent, TooltipTrigger } from "@mdcz/ui";
import {
  FileText,
  FolderCog,
  Inbox,
  Info,
  Languages,
  LayoutDashboard,
  Library,
  type LucideIcon,
  Menu,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PlaySquare,
  Settings,
  Sun,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import AppLogo from "../assets/logo.png";
import { useLocaleStore, useT } from "../i18n";
import { preloadSettingsExperience } from "../settings";
import { useTheme } from "./theme";

export interface ShellNavItem {
  icon: LucideIcon;
  id: DesktopRouteId;
  to: string;
}

export interface ShellLinkProps {
  children: ReactNode;
  className?: string;
  onFocus?: () => void;
  onMouseEnter?: () => void;
  to: string;
}

export interface AppShellProps {
  children: ReactNode;
  currentPath: string;
  linkComponent: (props: ShellLinkProps) => ReactNode;
  systemNav?: ShellNavItem[];
  /** Counts shown beside nav items, such as the pending items waiting for the user. */
  navBadges?: Partial<Record<DesktopRouteId, number>>;
}

const COLLAPSED_STORAGE_KEY = "mdcz-sidebar-collapsed";

const SHELL_ROUTE_ICONS: Record<DesktopRouteId, LucideIcon> = {
  about: Info,
  libraries: FolderCog,
  library: Library,
  logs: FileText,
  overview: LayoutDashboard,
  pending: Inbox,
  settings: Settings,
  tools: Wrench,
  workbench: PlaySquare,
};

const toShellNavItem = (route: DesktopRouteDefinition): ShellNavItem => ({
  icon: SHELL_ROUTE_ICONS[route.id],
  id: route.id,
  to: route.path,
});

export const PRIMARY_SHELL_NAV: ShellNavItem[] = PRIMARY_DESKTOP_ROUTES.map(toShellNavItem);

export const SYSTEM_SHELL_NAV: ShellNavItem[] = SYSTEM_DESKTOP_ROUTES.map(toShellNavItem);

export function AppShell({
  children,
  currentPath,
  linkComponent: LinkComponent,
  systemNav = SYSTEM_SHELL_NAV,
  navBadges = {},
}: AppShellProps) {
  const { theme, setTheme } = useTheme();
  const t = useT();
  const [collapsed, setCollapsedState] = useState(
    () => typeof localStorage !== "undefined" && localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1",
  );
  const setCollapsed = (next: boolean) => {
    setCollapsedState(next);
    localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? "1" : "0");
  };
  // Open for the path it was opened on, so following any link closes it.
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const drawerOpen = drawerPath === currentPath;
  const themeMeta = useMemo(() => {
    if (theme === "light") return { icon: Sun, label: t.shell.themeLight };
    if (theme === "dark") return { icon: Moon, label: t.shell.themeDark };
    return { icon: Monitor, label: t.shell.themeSystem };
  }, [t, theme]);

  const cycleTheme = () => {
    setTheme(theme === "light" ? "dark" : theme === "dark" ? "system" : "light");
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 bg-sidebar px-2 text-sidebar-foreground md:hidden">
        <Button variant="ghost" size="icon" aria-label={t.shell.openMenu} onClick={() => setDrawerPath(currentPath)}>
          <Menu />
        </Button>
        <img src={AppLogo} alt="" className="h-5 w-5 rounded-md ring-1 ring-border/60" />
        <span className="select-none text-base font-semibold tracking-tight">MDCz</span>
      </header>
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label={t.shell.closeMenu}
            className="absolute inset-0 bg-black/40"
            onClick={() => setDrawerPath(null)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-[200px] flex-col bg-sidebar text-sidebar-foreground shadow-xl">
            <NavContent
              collapsed={false}
              currentPath={currentPath}
              linkComponent={LinkComponent}
              navBadges={navBadges}
              onCollapse={() => setDrawerPath(null)}
              onThemeToggle={cycleTheme}
              systemNav={systemNav}
              themeIcon={themeMeta.icon}
              themeLabel={themeMeta.label}
            />
          </aside>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          className={cn(
            // Sized to the longest label so every locale fits; interpolate-size lets the width still animate.
            "hidden shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-300 ease-in-out [interpolate-size:allow-keywords] md:flex",
            collapsed ? "w-[60px]" : "w-max",
          )}
        >
          <NavContent
            collapsed={collapsed}
            currentPath={currentPath}
            linkComponent={LinkComponent}
            navBadges={navBadges}
            onCollapse={setCollapsed}
            onThemeToggle={cycleTheme}
            systemNav={systemNav}
            themeIcon={themeMeta.icon}
            themeLabel={themeMeta.label}
          />
        </aside>
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden md:py-2 md:pl-2">
          <div className="flex-1 overflow-hidden bg-surface md:rounded-l-xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

function NavContent({
  collapsed,
  currentPath,
  linkComponent,
  navBadges,
  onCollapse,
  onThemeToggle,
  systemNav,
  themeIcon: ThemeIcon,
  themeLabel,
}: {
  collapsed: boolean;
  currentPath: string;
  linkComponent: (props: ShellLinkProps) => ReactNode;
  navBadges: Partial<Record<DesktopRouteId, number>>;
  onCollapse: (collapsed: boolean) => void;
  onThemeToggle: () => void;
  systemNav: ShellNavItem[];
  themeIcon: LucideIcon;
  themeLabel: string;
}) {
  const t = useT();
  const { locale, setLocale } = useLocaleStore();
  return (
    <div className={cn("flex h-full flex-col", !collapsed && "min-w-[130px]")}>
      <div className={cn("flex h-20 shrink-0 items-center justify-center", collapsed ? "px-2" : "px-5")}>
        {collapsed ? (
          <img src={AppLogo} alt="MDCz" className="h-5 w-5 rounded-md shadow-sm ring-1 ring-border/60" />
        ) : (
          <div className="flex items-center gap-2.5">
            <img src={AppLogo} alt="MDCz" className="h-6 w-6 rounded-lg shadow-sm ring-1 ring-border/60" />
            <span className="select-none text-lg font-semibold tracking-tight">MDCz</span>
          </div>
        )}
      </div>
      <Separator className="mx-auto my-1 w-[calc(100%-32px)]! opacity-40" />
      <nav className={cn("flex flex-1 flex-col gap-2 overflow-y-auto py-3", collapsed ? "items-center px-1.5" : "")}>
        {PRIMARY_SHELL_NAV.map((item) => (
          <NavLink
            key={item.to}
            collapsed={collapsed}
            badge={navBadges[item.id]}
            isActive={currentPath === item.to}
            item={item}
            linkComponent={linkComponent}
          />
        ))}
        <Separator />
        {systemNav.map((item) => (
          <NavLink
            key={item.to}
            collapsed={collapsed}
            badge={navBadges[item.id]}
            isActive={currentPath === item.to}
            item={item}
            linkComponent={linkComponent}
          />
        ))}
      </nav>
      <div
        className={cn(
          "flex shrink-0 items-center border-t",
          collapsed ? "flex-col gap-1 px-1.5 py-2" : "justify-between px-3 py-2",
        )}
      >
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
              aria-label={themeLabel}
              onClick={onThemeToggle}
            >
              <ThemeIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent side={collapsed ? "right" : "top"}>{themeLabel}</TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
              aria-label={t.shell.switchLanguage}
              onClick={() => setLocale(locale === "zh-CN" ? "en-US" : "zh-CN")}
            >
              <Languages />
            </Button>
          </TooltipTrigger>
          <TooltipContent side={collapsed ? "right" : "top"}>{t.shell.switchLanguage}</TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
              aria-label={collapsed ? t.shell.expandSidebar : t.shell.collapseSidebar}
              onClick={() => onCollapse(!collapsed)}
            >
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side={collapsed ? "right" : "top"}>
            {collapsed ? t.shell.expandSidebar : t.shell.collapseSidebar}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function NavLink({
  badge,
  collapsed,
  isActive,
  item,
  linkComponent: LinkComponent,
}: {
  badge?: number;
  collapsed: boolean;
  isActive: boolean;
  item: ShellNavItem;
  linkComponent: (props: ShellLinkProps) => ReactNode;
}) {
  const t = useT();
  const Icon = item.icon;
  const label = t.shell.nav[item.id];
  const preloadOnIntent = () => {
    if (item.to === "/settings") {
      void preloadSettingsExperience();
    }
  };
  const link = (
    <NavButton asChild isActive={isActive} collapsed={collapsed}>
      {LinkComponent({
        to: item.to,
        onFocus: preloadOnIntent,
        onMouseEnter: preloadOnIntent,
        children: (
          <>
            <Icon className={cn("h-5 w-5", !collapsed && "shrink-0")} strokeWidth={isActive ? 2.5 : 2} />
            {collapsed ? (
              <span className="sr-only">{label}</span>
            ) : (
              // The hidden bold copy reserves the active width, so labels never shift or clip when selected.
              <span className="grid whitespace-nowrap">
                <span className="col-start-1 row-start-1">{label}</span>
                <span className="invisible col-start-1 row-start-1 font-bold">{label}</span>
              </span>
            )}
            {badge ? (
              collapsed ? (
                <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-foreground" />
              ) : (
                <span className="ml-auto pl-1 font-numeric text-xs text-muted-foreground tabular-nums">{badge}</span>
              )
            ) : null}
          </>
        ),
      })}
    </NavButton>
  );

  if (!collapsed) {
    return link;
  }

  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
