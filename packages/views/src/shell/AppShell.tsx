import {
  type DesktopRouteDefinition,
  type DesktopRouteId,
  PRIMARY_DESKTOP_ROUTES,
  SYSTEM_DESKTOP_ROUTES,
} from "@mdcz/shared/desktopNavigation";
import { Button, cn, NavButton, Separator, Tooltip, TooltipContent, TooltipTrigger } from "@mdcz/ui";
import {
  FileText,
  Info,
  Languages,
  LayoutDashboard,
  Library,
  type LucideIcon,
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
  titlebar?: ReactNode;
  systemNav?: ShellNavItem[];
}

const SHELL_ROUTE_ICONS: Record<DesktopRouteId, LucideIcon> = {
  about: Info,
  library: Library,
  logs: FileText,
  overview: LayoutDashboard,
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
  titlebar,
  systemNav = SYSTEM_SHELL_NAV,
}: AppShellProps) {
  const { theme, setTheme } = useTheme();
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);
  const themeMeta = useMemo(() => {
    if (theme === "light") return { icon: Sun, label: t.shell.themeLight };
    if (theme === "dark") return { icon: Moon, label: t.shell.themeDark };
    return { icon: Monitor, label: t.shell.themeSystem };
  }, [t, theme]);

  const cycleTheme = () => {
    setTheme(theme === "light" ? "dark" : theme === "dark" ? "system" : "light");
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {titlebar}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          className={cn(
            "flex shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-300 ease-in-out",
            collapsed ? "w-[60px]" : "w-[130px]",
          )}
        >
          <NavContent
            collapsed={collapsed}
            currentPath={currentPath}
            linkComponent={LinkComponent}
            onCollapse={setCollapsed}
            onThemeToggle={cycleTheme}
            systemNav={systemNav}
            themeIcon={themeMeta.icon}
            themeLabel={themeMeta.label}
          />
        </aside>
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden py-2 pl-2">
          <div className="flex-1 overflow-hidden rounded-l-xl bg-surface">{children}</div>
        </main>
      </div>
    </div>
  );
}

function NavContent({
  collapsed,
  currentPath,
  linkComponent,
  onCollapse,
  onThemeToggle,
  systemNav,
  themeIcon: ThemeIcon,
  themeLabel,
}: {
  collapsed: boolean;
  currentPath: string;
  linkComponent: (props: ShellLinkProps) => ReactNode;
  onCollapse: (collapsed: boolean) => void;
  onThemeToggle: () => void;
  systemNav: ShellNavItem[];
  themeIcon: LucideIcon;
  themeLabel: string;
}) {
  const t = useT();
  const { locale, setLocale } = useLocaleStore();
  return (
    <div className="flex h-full flex-col">
      <div className={cn("flex h-20 shrink-0 items-center", collapsed ? "justify-center px-2" : "gap-2 px-5")}>
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
  collapsed,
  isActive,
  item,
  linkComponent: LinkComponent,
}: {
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
            {collapsed ? <span className="sr-only">{label}</span> : <span className="truncate">{label}</span>}
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
