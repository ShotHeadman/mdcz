import { BrowserWindow, shell } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openExternalInstead, WindowService } from "./WindowService";

vi.mock("electron-window-state", () => ({
  default: () => ({ x: 0, y: 0, width: 1100, height: 750, manage: vi.fn() }),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WindowService", () => {
  it("opens only http(s) links in the system browser and never a second window", () => {
    const openExternal = vi.spyOn(shell, "openExternal");
    for (const url of ["https://github.com/ShotHeadman/mdcz", "javascript:alert(1)", "file:///etc/passwd"]) {
      expect(openExternalInstead({ url })).toEqual({ action: "deny" });
    }
    expect(openExternal.mock.calls).toEqual([["https://github.com/ShotHeadman/mdcz"]]);
  });

  it("hides to tray on close when closeToTray is enabled, and stays hidden on startup when startMinimizedToTray is enabled", () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    vi.spyOn(BrowserWindow.prototype, "once").mockImplementation(function (this: BrowserWindow, event, listener) {
      handlers.set(String(event), listener as (...args: unknown[]) => void);
      return this;
    });
    vi.spyOn(BrowserWindow.prototype, "on").mockImplementation(function (this: BrowserWindow, event, listener) {
      handlers.set(String(event), listener as (...args: unknown[]) => void);
      return this;
    });
    const show = vi.spyOn(BrowserWindow.prototype, "show");
    const hide = vi.spyOn(BrowserWindow.prototype, "hide");
    const setSkipTaskbar = vi.spyOn(BrowserWindow.prototype, "setSkipTaskbar");
    const holdClose = vi.fn(() => true);

    const service = new WindowService();
    service.createMainWindow({ useCustomTitleBar: false, startMinimizedToTray: true, holdClose });
    service.applyUiConfig({ closeToTray: true, hideDock: false, hideMenu: false, hideWindowButtons: false });

    handlers.get("ready-to-show")?.();
    expect(show).not.toHaveBeenCalled();

    service.showMainWindow();
    expect(show).toHaveBeenCalledOnce();
    if (process.platform !== "darwin") {
      expect(setSkipTaskbar).toHaveBeenLastCalledWith(false);
    }

    const closeEvent = { preventDefault: vi.fn() };
    handlers.get("close")?.(closeEvent);
    expect(closeEvent.preventDefault).toHaveBeenCalledOnce();
    expect(hide).toHaveBeenCalledOnce();
    expect(holdClose).not.toHaveBeenCalled();
    if (process.platform !== "darwin") {
      expect(setSkipTaskbar).toHaveBeenLastCalledWith(true);
    }

    service.applyUiConfig({ closeToTray: false, hideDock: false, hideMenu: false, hideWindowButtons: false });
    const allowCloseEvent = { preventDefault: vi.fn() };
    handlers.get("close")?.(allowCloseEvent);
    expect(allowCloseEvent.preventDefault).not.toHaveBeenCalled();
    if (process.platform !== "darwin") {
      expect(holdClose).toHaveBeenCalledOnce();
    }
  });
});
