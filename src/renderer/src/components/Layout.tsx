import { Link, useLocation } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
  FileText,
  Info,
  LayoutDashboard,
  Menu,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sun,
  Wrench,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import AppLogo from "@/assets/images/logo.png";
import { Button } from "@/components/ui/Button";
import { NavButton } from "@/components/ui/NavButton";
import { Separator } from "@/components/ui/Separator";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/Sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import { useTheme } from "@/contexts/ThemeProvider";
import { useCurrentConfig } from "@/hooks/useCurrentConfig";
import { cn } from "@/lib/utils";

interface LayoutProps {
  children: ReactNode;
}

interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
}

// Primary workflow pages
const PRIMARY_NAV: NavItem[] = [
  { label: "工作台", to: "/", icon: LayoutDashboard },
  { label: "工具", to: "/tool", icon: Wrench },
];

// System / configuration pages
const SYSTEM_NAV: NavItem[] = [
  { label: "设置", to: "/settings", icon: Settings },
  { label: "日志", to: "/logs", icon: FileText },
  { label: "关于", to: "/about", icon: Info },
];

function NavLink({ item, collapsed, isActive }: { item: NavItem; collapsed: boolean; isActive: boolean }) {
  const Icon = item.icon;

  if (collapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <NavButton asChild isActive={isActive} collapsed={true}>
            <Link to={item.to}>
              <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
              <span className="sr-only">{item.label}</span>
            </Link>
          </NavButton>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {item.label}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <NavButton asChild isActive={isActive} collapsed={false}>
      <Link to={item.to}>
        <Icon className="h-5 w-5 shrink-0" strokeWidth={isActive ? 2.5 : 2} />
        <span className="truncate">{item.label}</span>
      </Link>
    </NavButton>
  );
}

function NavContent({
  collapsed = false,
  pathname,
  onThemeToggle,
  themeIcon: ThemeIcon,
  themeLabel,
  onCollapse,
  systemNav = SYSTEM_NAV,
}: {
  collapsed?: boolean;
  pathname: string;
  onThemeToggle: () => void;
  themeIcon: LucideIcon;
  themeLabel: string;
  onCollapse?: (collapsed: boolean) => void;
  systemNav?: NavItem[];
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Header / Branding */}
      <div className={cn("flex items-center h-14 shrink-0", collapsed ? "justify-center px-2" : "gap-2 px-4")}>
        {collapsed ? (
          <img src={AppLogo} alt="MDCz" className="h-5 w-5 rounded-md ring-1 ring-border/60 shadow-sm" />
        ) : (
          <div className="flex items-center gap-2.5">
            <img src={AppLogo} alt="MDCz" className="h-6 w-6 rounded-lg ring-1 ring-border/60 shadow-sm" />
            <span className="text-lg font-semibold tracking-tight select-none">MDCz</span>
          </div>
        )}
      </div>

      <Separator className="w-[calc(100%-16px)]! mx-auto my-1" />

      {/* Navigation */}
      <nav
        className={cn("flex-1 overflow-y-auto flex flex-col gap-1 py-3", collapsed ? "items-center px-1.5" : "px-2")}
      >
        {PRIMARY_NAV.map((item) => (
          <NavLink key={item.to} item={item} collapsed={collapsed} isActive={pathname === item.to} />
        ))}

        <Separator />

        {systemNav.map((item) => (
          <NavLink key={item.to} item={item} collapsed={collapsed} isActive={pathname === item.to} />
        ))}
      </nav>

      {/* Footer */}
      <div
        className={cn(
          "flex items-center shrink-0 border-t",
          collapsed ? "flex-col gap-1 py-2 px-1.5" : "justify-between py-2 px-3",
        )}
      >
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
              onClick={onThemeToggle}
            >
              <ThemeIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent side={collapsed ? "right" : "top"}>{themeLabel}</TooltipContent>
        </Tooltip>

        {onCollapse && (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                onClick={() => onCollapse(!collapsed)}
              >
                {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side={collapsed ? "right" : "top"}>{collapsed ? "展开侧栏" : "收起侧栏"}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

export default function Layout({ children }: LayoutProps) {
  const { theme, setTheme } = useTheme();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const location = useLocation();
  const pathname = location.pathname;

  const configQ = useCurrentConfig();

  const filteredSystemNav = useMemo(() => {
    const showLogsPanel = configQ.data?.ui?.showLogsPanel ?? true;
    if (!showLogsPanel) {
      return SYSTEM_NAV.filter((item) => item.to !== "/logs");
    }
    return SYSTEM_NAV;
  }, [configQ.data?.ui?.showLogsPanel]);

  const cycleTheme = () => {
    setTheme(theme === "light" ? "dark" : theme === "dark" ? "system" : "light");
  };

  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const themeLabel = theme === "light" ? "浅色模式" : theme === "dark" ? "深色模式" : "跟随系统";

  return (
    <div className="flex h-dvh bg-background overflow-hidden">
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          "hidden md:flex md:flex-col bg-sidebar text-sidebar-foreground border-r shrink-0 transition-[width] duration-300 ease-in-out",
          isCollapsed ? "w-[60px]" : "w-[160px]",
        )}
      >
        <NavContent
          collapsed={isCollapsed}
          pathname={pathname}
          onThemeToggle={cycleTheme}
          themeIcon={ThemeIcon}
          themeLabel={themeLabel}
          onCollapse={setIsCollapsed}
          systemNav={filteredSystemNav}
        />
      </aside>

      {/* Mobile Sidebar */}
      <Sheet>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden fixed top-3 left-3 z-50 h-9 w-9 rounded-lg bg-sidebar/80 backdrop-blur"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-[220px] p-0 bg-sidebar">
          <NavContent
            pathname={pathname}
            onThemeToggle={cycleTheme}
            themeIcon={ThemeIcon}
            themeLabel={themeLabel}
            systemNav={filteredSystemNav}
          />
        </SheetContent>
      </Sheet>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex-1 overflow-hidden">{children}</div>
      </main>
    </div>
  );
}
