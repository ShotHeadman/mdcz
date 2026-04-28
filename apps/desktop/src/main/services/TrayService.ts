import type { WindowService } from "@main/services/WindowService";
import { app, Menu, nativeImage, Tray } from "electron";

import trayIconPath from "../../../build/tray_icon.png?asset";

export class TrayService {
  private tray: Tray | null = null;

  initialize(windowService: WindowService): void {
    if (this.tray) {
      return;
    }

    const trayIcon = nativeImage.createFromPath(trayIconPath);

    this.tray = new Tray(trayIcon);
    this.tray.setToolTip("MDCz");
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: "Show Window",
          click: () => {
            windowService.showMainWindow();
          },
        },
        {
          label: "Quit",
          click: () => {
            app.quit();
          },
        },
      ]),
    );

    this.tray.on("double-click", () => {
      windowService.showMainWindow();
    });
  }

  dispose(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
