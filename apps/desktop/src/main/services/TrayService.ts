import { app, Menu, nativeImage, Tray } from "electron";
import trayIconPath from "../../../build/tray_icon.png?asset";

const TRAY_MENU_TEXT = {
  zh: { showWindow: "显示主窗口", quit: "退出" },
  en: { showWindow: "Show Window", quit: "Quit" },
};

export class TrayService {
  private tray: Tray | null = null;

  initialize(onShowWindow: () => void): void {
    if (this.tray) {
      return;
    }

    const trayIcon = nativeImage.createFromPath(trayIconPath);
    const text = TRAY_MENU_TEXT[app.getLocale().toLowerCase().startsWith("zh") ? "zh" : "en"];

    this.tray = new Tray(trayIcon);
    this.tray.setToolTip("MDCz");
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: text.showWindow,
          click: () => {
            onShowWindow();
          },
        },
        {
          label: text.quit,
          click: () => {
            app.quit();
          },
        },
      ]),
    );

    if (process.platform !== "darwin") {
      this.tray.on("click", () => {
        onShowWindow();
      });
    }
  }

  dispose(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
