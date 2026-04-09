import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import type { WindowService } from "@main/services/WindowService";
import { IpcChannel } from "@shared/IpcChannel";
import type { RendererShortcutAction, ShortcutPayload } from "@shared/ipcEvents";
import type { BrowserWindow, Event, Input } from "electron";

const DEFAULT_SHORTCUTS = {
  startOrStopScrape: "S",
  retryScrape: "R",
  deleteFile: "D",
  deleteFileAndFolder: "Shift+D",
  openFolder: "F",
  editNfo: "E",
  playVideo: "P",
} as const;

const RENDERER_SHORTCUT_BINDINGS = [
  { key: "startOrStopScrape", action: "start-or-stop-scrape" },
  { key: "retryScrape", action: "retry-scrape" },
  { key: "deleteFile", action: "delete-file" },
  { key: "deleteFileAndFolder", action: "delete-file-and-folder" },
  { key: "openFolder", action: "open-folder" },
  { key: "editNfo", action: "edit-nfo" },
  { key: "playVideo", action: "play-video" },
] as const;

interface ShortcutMatcher {
  key: string;
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

interface BoundRendererShortcut {
  action: RendererShortcutAction;
  shortcut: string;
  matcher: ShortcutMatcher;
}

const normalizeShortcutKey = (value: string): string | null => {
  const token = value.trim().toLowerCase();
  if (!token) {
    return null;
  }
  const aliases: Record<string, string> = {
    esc: "escape",
    return: "enter",
    spacebar: "space",
    " ": "space",
    del: "delete",
    left: "arrowleft",
    right: "arrowright",
    up: "arrowup",
    down: "arrowdown",
  };
  const mapped = aliases[token] ?? token;
  if (/^[a-z0-9]$/u.test(mapped)) {
    return mapped;
  }
  if (/^f([1-9]|1[0-2])$/u.test(mapped)) {
    return mapped;
  }
  if (["enter", "escape", "tab", "backspace", "delete", "space"].includes(mapped)) {
    return mapped;
  }
  if (["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(mapped)) {
    return mapped;
  }
  return null;
};

const parseShortcutMatcher = (shortcut: string): ShortcutMatcher | null => {
  const parts = shortcut
    .split("+")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (parts.length === 0) {
    return null;
  }

  const matcher: ShortcutMatcher = {
    key: "",
    mod: false,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
  };

  for (const part of parts) {
    const token = part.toLowerCase().replace(/\s+/gu, "");
    if (token === "mod") {
      matcher.mod = true;
      continue;
    }
    if (token === "ctrl") {
      matcher.ctrl = true;
      continue;
    }
    if (token === "meta") {
      matcher.meta = true;
      continue;
    }
    if (token === "alt") {
      matcher.alt = true;
      continue;
    }
    if (token === "shift") {
      matcher.shift = true;
      continue;
    }

    const normalizedKey = normalizeShortcutKey(token);
    if (!normalizedKey || matcher.key) {
      return null;
    }
    matcher.key = normalizedKey;
  }

  return matcher.key ? matcher : null;
};

const normalizeInputKey = (rawKey: string): string => {
  const key = rawKey.trim().toLowerCase();
  if (!key) {
    return "";
  }
  if (key === " ") {
    return "space";
  }
  return key;
};

const matchesShortcut = (input: Input, matcher: ShortcutMatcher): boolean => {
  const key = normalizeInputKey(input.key ?? "");
  if (key !== matcher.key) {
    return false;
  }

  const ctrlPressed = Boolean(input.control);
  const metaPressed = Boolean(input.meta);
  const altPressed = Boolean(input.alt);
  const shiftPressed = Boolean(input.shift);

  if (matcher.mod && !ctrlPressed && !metaPressed) {
    return false;
  }
  if (matcher.ctrl && !ctrlPressed) {
    return false;
  }
  if (matcher.meta && !metaPressed) {
    return false;
  }
  if (matcher.alt && !altPressed) {
    return false;
  }
  if (matcher.shift && !shiftPressed) {
    return false;
  }

  const allowCtrl = matcher.ctrl || matcher.mod;
  const allowMeta = matcher.meta || matcher.mod;
  if (ctrlPressed && !allowCtrl) {
    return false;
  }
  if (metaPressed && !allowMeta) {
    return false;
  }
  if (altPressed && !matcher.alt) {
    return false;
  }
  if (shiftPressed && !matcher.shift) {
    return false;
  }

  return true;
};

export class ShortcutService {
  private readonly logger = loggerService.getLogger("ShortcutService");

  private disposeRendererListener: (() => void) | null = null;

  initialize(windowService: WindowService, configuration: Configuration): void {
    this.disposeRendererListener?.();
    this.disposeRendererListener = null;

    const window = windowService.getMainWindow();
    if (!window || window.webContents.isDestroyed()) {
      return;
    }

    const rendererShortcuts: BoundRendererShortcut[] = [];
    for (const binding of RENDERER_SHORTCUT_BINDINGS) {
      const configuredShortcut = configuration.shortcuts?.[binding.key] ?? DEFAULT_SHORTCUTS[binding.key];
      const normalizedShortcut = configuredShortcut.trim();
      if (!normalizedShortcut) {
        continue;
      }
      const matcher = parseShortcutMatcher(normalizedShortcut);
      if (!matcher) {
        this.logger.warn(`Ignored invalid shortcut for ${binding.key}: ${configuredShortcut}`);
        continue;
      }
      rendererShortcuts.push({
        action: binding.action,
        shortcut: normalizedShortcut,
        matcher,
      });
    }

    const listener = (_event: Event, input: Input) => {
      if (input.type !== "keyDown") {
        return;
      }

      for (const binding of rendererShortcuts) {
        if (!matchesShortcut(input, binding.matcher)) {
          continue;
        }
        this.emitShortcut(window, {
          action: binding.action,
          shortcut: binding.shortcut,
        });
        break;
      }
    };

    window.webContents.on("before-input-event", listener);
    this.disposeRendererListener = () => {
      if (window.isDestroyed() || window.webContents.isDestroyed()) {
        return;
      }
      window.webContents.removeListener("before-input-event", listener);
    };
  }

  dispose(): void {
    this.disposeRendererListener?.();
    this.disposeRendererListener = null;
  }

  private emitShortcut(window: BrowserWindow, payload: ShortcutPayload): void {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
      return;
    }
    window.webContents.send(IpcChannel.Event_Shortcut, payload);
  }
}
