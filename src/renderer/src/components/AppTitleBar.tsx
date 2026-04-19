import { useLocation } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import AppLogo from "@/assets/images/logo.png";

const DRAG_STYLE = {
  WebkitAppRegion: "drag",
} as CSSProperties;

const TITLE_BY_PATH: Record<string, string> = {
  "/dashboard": "仪表盘",
  "/": "工作台",
  "/tool": "工具",
  "/settings": "设置",
  "/logs": "日志",
  "/about": "关于",
};

export function AppTitleBar() {
  const location = useLocation();
  const title = TITLE_BY_PATH[location.pathname] ?? "MDCz";

  return (
    <header
      className="flex h-9 shrink-0 select-none items-center border-b border-border/70 bg-background/82 text-sm backdrop-blur"
      style={{ ...DRAG_STYLE, paddingLeft: "max(12px, env(titlebar-area-x, 0px))" }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <img src={AppLogo} alt="MDCz" className="h-4 w-4 rounded" />
        <div className="truncate text-xs font-medium text-muted-foreground">{title}</div>
      </div>
      <div aria-hidden="true" className="h-full shrink-0" style={{ width: "env(titlebar-area-width, 138px)" }} />
    </header>
  );
}
