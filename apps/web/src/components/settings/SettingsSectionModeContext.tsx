import { createContext, type ReactNode, useContext } from "react";
import { FIELD_REGISTRY_BY_KEY } from "./settingsRegistry";

export type SettingsSectionMode = "public" | "advanced";

const SettingsSectionModeContext = createContext<SettingsSectionMode>("public");

interface SettingsSectionModeProviderProps {
  mode: SettingsSectionMode;
  children?: ReactNode;
}

export function SettingsSectionModeProvider({ mode, children }: SettingsSectionModeProviderProps) {
  return <SettingsSectionModeContext.Provider value={mode}>{children}</SettingsSectionModeContext.Provider>;
}

export function useSettingsSectionMode(): SettingsSectionMode {
  return useContext(SettingsSectionModeContext);
}

export function shouldRenderFieldInSectionMode(name: string, mode: SettingsSectionMode): boolean {
  const entry = FIELD_REGISTRY_BY_KEY[name];
  if (!entry) {
    return mode === "public";
  }

  return mode === "advanced" ? entry.visibility === "advanced" : entry.visibility !== "advanced";
}
