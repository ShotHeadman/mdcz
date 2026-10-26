import { CUSTOM_TITLE_BAR_ARG, DESKTOP_BRIDGE_CALLS, type DesktopBridge } from "@mdcz/shared/desktopBridge";
import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";

const calls = Object.fromEntries(
  DESKTOP_BRIDGE_CALLS.map((name) => [name, (...args: unknown[]) => ipcRenderer.invoke(`desktop:${name}`, ...args)]),
);

const bridge: DesktopBridge = {
  ...(calls as Omit<DesktopBridge, "on" | "customTitleBar">),
  customTitleBar: process.argv.includes(CUSTOM_TITLE_BAR_ARG),
  on: (event, listener) => {
    const channel = `desktop:${event}`;
    const handler = (_event: IpcRendererEvent, payload: unknown) => listener(payload as never);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
};

contextBridge.exposeInMainWorld("mdczDesktop", bridge);
