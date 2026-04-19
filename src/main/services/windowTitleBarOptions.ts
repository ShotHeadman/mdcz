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
const TITLE_BAR_OVERLAY_DARK = {
  color: "#0f1419",
  symbolColor: "#e2e2e2",
} as const;
const TITLE_BAR_OVERLAY_LIGHT = {
  color: "#f9f9f9",
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
