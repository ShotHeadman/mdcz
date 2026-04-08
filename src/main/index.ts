import { bootstrap } from "@main/bootstrap";
import type { ServiceContainer } from "@main/container";
import { createContainer } from "@main/createContainer";
import { registerIpcHandlers } from "@main/ipc";
import { registerLocalFileHandler, registerLocalFileScheme } from "@main/localFileProtocol";
import { configManager } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import { NetworkClient } from "@main/services/network";
import { ShortcutService } from "@main/services/ShortcutService";
import { SignalService } from "@main/services/SignalService";
import { TrayService } from "@main/services/TrayService";
import { UpdateService } from "@main/services/UpdateService";
import { WindowService } from "@main/services/WindowService";
import { app, BrowserWindow } from "electron";

const signalService = new SignalService();
const sharedNetworkClient = new NetworkClient({
  getProxyUrl: () => configManager.getComputed().proxyUrl,
  getTimeoutMs: () => configManager.getComputed().networkTimeoutMs,
  getRetryCount: () => configManager.getComputed().networkRetryCount,
});
const updateService = new UpdateService(sharedNetworkClient);
let windowService: WindowService | null = null;
let serviceContainer: ServiceContainer | null = null;
const trayService = new TrayService();
const shortcutService = new ShortcutService();
let ipcRegistered = false;
let cleanupPromise: Promise<void> | null = null;
let allowQuitAfterCleanup = false;
let disposeShortcutConfigListener: (() => void) | null = null;
let disposeLoggerListener: (() => void) | null = loggerService.onLog((payload) => {
  signalService.forwardLoggerLog(payload);
});

const ensureWindowService = (): WindowService => {
  if (!windowService) {
    windowService = new WindowService();
  }

  return windowService;
};

const ensureMainWindow = async (): Promise<void> => {
  const currentWindowService = ensureWindowService();
  const mainWindow = currentWindowService.createMainWindow();
  signalService.setMainWindow(mainWindow);

  if (!ipcRegistered) {
    const container: ServiceContainer = createContainer({
      windowService: currentWindowService,
      signalService,
      networkClient: sharedNetworkClient,
    });

    registerIpcHandlers(container);
    serviceContainer = container;
    ipcRegistered = true;
  }

  await currentWindowService.loadMainWindow();
};

const cleanupResources = async (): Promise<void> => {
  if (cleanupPromise) {
    return cleanupPromise;
  }

  cleanupPromise = (async () => {
    const logger = loggerService.getLogger("Main");
    try {
      await serviceContainer?.shutdown();
    } catch (error) {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      logger.error(`Failed to shutdown services cleanly: ${message}`);
    }

    disposeLoggerListener?.();
    disposeLoggerListener = null;
    disposeShortcutConfigListener?.();
    disposeShortcutConfigListener = null;
    shortcutService.dispose();
    trayService.dispose();
    await loggerService.close();
  })();

  return cleanupPromise;
};

// Must be called before app.whenReady()
registerLocalFileScheme();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!windowService) {
      return;
    }

    windowService.showMainWindow();
  });

  app
    .whenReady()
    .then(async () => {
      await bootstrap();
      registerLocalFileHandler();
      await ensureMainWindow();

      if (windowService) {
        trayService.initialize(windowService);
        const initialConfig = await configManager.getValidated();
        shortcutService.initialize(windowService, initialConfig);
        loggerService.reconfigure(initialConfig.behavior.saveLog);
        windowService.applyUiConfig(initialConfig.ui);

        disposeShortcutConfigListener?.();
        disposeShortcutConfigListener = configManager.onChange((configuration) => {
          if (!windowService) {
            return;
          }
          shortcutService.initialize(windowService, configuration);
          loggerService.reconfigure(configuration.behavior.saveLog);
          windowService.applyUiConfig(configuration.ui);
        });

        // Check for updates on startup (after a short delay to avoid blocking)
        if (initialConfig.behavior.updateCheck) {
          setTimeout(() => {
            void updateService.checkAndNotify(signalService);
          }, 5000);
        }
      }

      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          void ensureMainWindow().then(() => {
            if (windowService) {
              void (async () => {
                if (!windowService) {
                  return;
                }
                shortcutService.initialize(windowService, await configManager.getValidated());
              })();
            }
          });
          return;
        }

        windowService?.showMainWindow();
      });
    })
    .catch((error) => {
      const logger = loggerService.getLogger("Main");
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      logger.error(`Failed to initialize main process: ${message}`);
      app.quit();
    });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  const handleQuitCleanup = (event: Electron.Event) => {
    if (allowQuitAfterCleanup) {
      return;
    }

    event.preventDefault();
    void cleanupResources().finally(() => {
      allowQuitAfterCleanup = true;
      app.quit();
    });
  };

  app.on("before-quit", handleQuitCleanup);
  app.on("will-quit", handleQuitCleanup);
}
