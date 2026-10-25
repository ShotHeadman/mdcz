import { createContext, type ReactNode, useContext, useLayoutEffect, useState } from "react";

export type Theme = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

const STORAGE_KEY = "vite-ui-theme";

const readStoredTheme = (): Theme => {
  const stored = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
  return stored === "dark" || stored === "light" ? stored : "system";
};

const applyTheme = (theme: Theme): ResolvedTheme => {
  const resolved: ResolvedTheme =
    theme === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
  const root = window.document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
  return resolved;
};

/** Runs before React mounts, so a dark theme never first paints light. */
export const applyStoredTheme = (): void => {
  applyTheme(readStoredTheme());
};

interface ThemeProviderState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeProviderContext = createContext<ThemeProviderState>({ theme: "system", setTheme: () => undefined });

export function ThemeProvider({
  children,
  onResolvedThemeChange,
}: {
  children: ReactNode;
  onResolvedThemeChange?: (theme: ResolvedTheme) => void;
}) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);

  useLayoutEffect(() => {
    onResolvedThemeChange?.(applyTheme(theme));
  }, [onResolvedThemeChange, theme]);

  return (
    <ThemeProviderContext.Provider
      value={{
        theme,
        setTheme: (nextTheme) => {
          localStorage.setItem(STORAGE_KEY, nextTheme);
          setThemeState(nextTheme);
        },
      }}
    >
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeProviderContext);
