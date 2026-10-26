import type { RootFileRef } from "./mediaRef";

/** `manualDownloadUrl` is null when the running build can download and install the update itself. */
export type AppUpdateStatus =
  | { phase: "idle" | "checking" | "latest" }
  | { phase: "available"; version: string; releaseUrl: string; manualDownloadUrl: string | null }
  | { phase: "downloading"; version: string; percent: number }
  | { phase: "downloaded"; version: string }
  | { phase: "error"; message: string };

export interface DesktopAppInfo {
  version: string;
  arch: string;
  platform: string;
  isPackaged: boolean;
}

export type DesktopShortcutAction = "start-or-stop-scrape" | "retry-scrape" | "open-folder" | "edit-nfo" | "play-video";

export interface DesktopBrowseFilter {
  name: string;
  extensions: string[];
}

/** What only Electron can do for the web app; each call is an IPC invoke named `desktop:<call>`. */
export interface DesktopBridgeCalls {
  appInfo(): Promise<DesktopAppInfo>;
  updateStatus(): Promise<AppUpdateStatus>;
  checkForUpdate(): Promise<AppUpdateStatus>;
  downloadUpdate(): Promise<void>;
  installUpdate(): Promise<void>;
  relaunch(): Promise<void>;
  syncTitleBarTheme(isDark: boolean): Promise<void>;
  toggleDevTools(): Promise<void>;
  showItemInFolder(file: RootFileRef): Promise<void>;
  playMedia(file: RootFileRef): Promise<void>;
  openWatermarkDirectory(): Promise<void>;
  /** A native picker; returns the chosen host path. */
  browse(kind: "file" | "directory", filters?: DesktopBrowseFilter[]): Promise<string | null>;
}

/** Pushed by main as `desktop:<event>`. */
export interface DesktopBridgeEvents {
  shortcut: DesktopShortcutAction;
  updateStatus: AppUpdateStatus;
}

/** Main adds this renderer argument when the window has no native title bar. */
export const CUSTOM_TITLE_BAR_ARG = "--mdcz-custom-title-bar";

export interface DesktopBridge extends DesktopBridgeCalls {
  /** The window's frame is fixed at creation, so this holds until relaunch even if the setting changes. */
  readonly customTitleBar: boolean;
  on<TEvent extends keyof DesktopBridgeEvents>(
    event: TEvent,
    listener: (payload: DesktopBridgeEvents[TEvent]) => void,
  ): () => void;
}

// A record, so adding a call to the interface without listing it here fails to compile.
const CALLS: Record<keyof DesktopBridgeCalls, true> = {
  appInfo: true,
  updateStatus: true,
  checkForUpdate: true,
  downloadUpdate: true,
  installUpdate: true,
  relaunch: true,
  syncTitleBarTheme: true,
  toggleDevTools: true,
  showItemInFolder: true,
  playMedia: true,
  openWatermarkDirectory: true,
  browse: true,
};

export const DESKTOP_BRIDGE_CALLS = Object.keys(CALLS) as (keyof DesktopBridgeCalls)[];
