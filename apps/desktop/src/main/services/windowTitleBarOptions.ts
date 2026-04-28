export interface TitleBarOverlayOptions {
  color: string;
  symbolColor: string;
  height: number;
}

export interface CustomTitleBarWindowOptions {
  titleBarStyle?: "hidden" | "hiddenInset";
  titleBarOverlay?: TitleBarOverlayOptions;
}

const TITLE_BAR_OVERLAY_HEIGHT = 36;
// Colors mirror `--background` in index.css so native Win/Linux window controls
// blend with the custom AppTitleBar surface above the main content sheet.
const TITLE_BAR_OVERLAY_DARK = {
  color: "#171e26",
  symbolColor: "#e2e2e2",
} as const;
const TITLE_BAR_OVERLAY_LIGHT = {
  color: "#f4f4f5",
  symbolColor: "#1a1c1c",
} as const;

export const shouldSyncTitleBarOverlay = (platform: NodeJS.Platform = process.platform): boolean =>
  platform === "win32" || platform === "linux";

export const buildTitleBarOverlay = (isDark: boolean): TitleBarOverlayOptions => {
  const palette = isDark ? TITLE_BAR_OVERLAY_DARK : TITLE_BAR_OVERLAY_LIGHT;

  return {
    ...palette,
    height: TITLE_BAR_OVERLAY_HEIGHT,
  };
};

export const resolveCustomTitleBarWindowOptions = (input: {
  useCustomTitleBar: boolean;
  platform?: NodeJS.Platform;
  isDark?: boolean;
}): CustomTitleBarWindowOptions => {
  if (!input.useCustomTitleBar) {
    return {};
  }

  const platform = input.platform ?? process.platform;
  if (platform === "darwin") {
    return { titleBarStyle: "hiddenInset" };
  }

  if (!shouldSyncTitleBarOverlay(platform)) {
    return {};
  }

  return {
    titleBarStyle: "hidden",
    titleBarOverlay: buildTitleBarOverlay(input.isDark ?? false),
  };
};
