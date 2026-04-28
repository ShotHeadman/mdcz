import type { CSSProperties } from "react";

const DRAG_STYLE = {
  WebkitAppRegion: "drag",
} as CSSProperties;

export function AppTitleBar() {
  return (
    <header
      className="flex h-9 shrink-0 select-none items-center bg-background"
      style={{ ...DRAG_STYLE, paddingLeft: "max(12px, env(titlebar-area-x, 0px))" }}
    >
      <div className="flex-1" />
      <div aria-hidden="true" className="h-full shrink-0" style={{ width: "env(titlebar-area-width, 138px)" }} />
    </header>
  );
}
