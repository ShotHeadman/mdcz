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
import { type MainWindowCreationOptions, WindowService } from "@main/services/WindowService";
import { app, BrowserWindow } from "electron";

const QUIT_FORCE_EXIT_TIMEOUT_MS = 3_000;

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
let disposeShortcutConfigListener: (() => void) | null = null;
let disposeLoggerListener: (() => void) | null = loggerService.onLog((payload) => {
  signalService.forwardLoggerLog(payload);
});

const scheduleForceExit = (): void => {
  const timer = setTimeout(() => {
    app.exit(0);
  }, QUIT_FORCE_EXIT_TIMEOUT_MS);
  timer.unref?.();
};

const ensureWindowService = (): WindowService => {
  if (!windowService) {
    windowService = new WindowService();
  }

  return windowService;
};

const toMainWindowCreationOptions = (
  config: Awaited<ReturnType<typeof configManager.getValidated>>,
): MainWindowCreationOptions => ({
  useCustomTitleBar: config.ui.useCustomTitleBar,
});

const ensureMainWindow = async (options: MainWindowCreationOptions): Promise<void> => {
  const currentWindowService = ensureWindowService();
  const mainWindow = currentWindowService.createMainWindow(options);
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
    await loggerService.close();
    trayService.dispose();
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
      const initialConfig = await configManager.getValidated();
      await ensureMainWindow(toMainWindowCreationOptions(initialConfig));

      if (windowService) {
        trayService.initialize(windowService);
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
          void (async () => {
            const config = await configManager.getValidated();
            await ensureMainWindow(toMainWindowCreationOptions(config));
            if (windowService) {
              shortcutService.initialize(windowService, config);
            }
          })();
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

  app.on("before-quit", () => {
    void cleanupResources();
    scheduleForceExit();
  });
}
