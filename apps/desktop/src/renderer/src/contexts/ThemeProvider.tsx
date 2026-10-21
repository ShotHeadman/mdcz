import { ThemeProvider as SharedThemeProvider, type Theme } from "@mdcz/views/shell";
import type { ReactNode } from "react";
import { ipc } from "@/client/ipc";

export type { Theme };

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
}: {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}) {
  return (
    <SharedThemeProvider
      defaultTheme={defaultTheme}
      storageKey={storageKey}
      onResolvedThemeChange={(resolvedTheme) => {
        void ipc.app.syncTitleBarTheme(resolvedTheme === "dark").catch(() => undefined);
      }}
    >
      {children}
    </SharedThemeProvider>
  );
}

export { useTheme } from "@mdcz/views/shell";
