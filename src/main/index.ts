import { bootstrap } from "@main/bootstrap";
import type { ServiceContainer } from "@main/container";
import { registerIpcHandlers } from "@main/ipc";
import { registerLocalFileHandler, registerLocalFileScheme } from "@main/localFileProtocol";
import { ActorImageService } from "@main/services/ActorImageService";
import {
  ActorSourceProvider,
  ActorSourceRegistry,
  AvbaseActorSource,
  AvjohoActorSource,
  GfriendsActorSource,
  LocalActorSource,
  OfficialActorSource,
} from "@main/services/actorSource";
import { type Configuration, configManager } from "@main/services/config";
import { CrawlerProvider, FetchGateway } from "@main/services/crawler";
import { EmbyActorInfoService, EmbyActorPhotoService } from "@main/services/emby";
import { JellyfinActorInfoService, JellyfinActorPhotoService } from "@main/services/jellyfin";
import { loggerService } from "@main/services/LoggerService";
import { NetworkClient } from "@main/services/network";
import { ShortcutService } from "@main/services/ShortcutService";
import { SignalService } from "@main/services/SignalService";
import { ScraperService } from "@main/services/scraper";
import { AmazonJpImageService } from "@main/services/scraper/AmazonJpImageService";
import { MaintenanceService } from "@main/services/scraper/maintenance/MaintenanceService";
import { TrayService } from "@main/services/TrayService";
import { AmazonPosterToolService, SymlinkService } from "@main/services/tools";
import { UpdateService } from "@main/services/UpdateService";
import { WindowService } from "@main/services/WindowService";
import { app, BrowserWindow } from "electron";

const signalService = new SignalService();
let windowService: WindowService | null = null;
const trayService = new TrayService();
const shortcutService = new ShortcutService();
let ipcRegistered = false;
let cleaningUp = false;
let disposeShortcutConfigListener: (() => void) | null = null;
let disposeLoggerListener: (() => void) | null = loggerService.onLog((payload) => {
  signalService.forwardLoggerLog(payload);
});

const ensureMainWindow = async (): Promise<void> => {
  if (!windowService) {
    windowService = new WindowService();
  }

  const mainWindow = windowService.createMainWindow();
  signalService.setMainWindow(mainWindow);

  if (!ipcRegistered) {
    const networkClient = new NetworkClient({
      getProxyUrl: () => configManager.getComputed().proxyUrl,
      getTimeoutMs: () => configManager.getComputed().networkTimeoutMs,
      getRetryCount: () => configManager.getComputed().networkRetryCount,
    });
    const fetchGateway = new FetchGateway(networkClient);
    const crawlerProvider = new CrawlerProvider({
      fetchGateway,
    });
    const amazonJpImageService = new AmazonJpImageService(networkClient);
    const actorImageService = new ActorImageService({ networkClient });
    const actorSourceProvider = new ActorSourceProvider({
      registry: new ActorSourceRegistry([
        new LocalActorSource(actorImageService),
        new OfficialActorSource({ networkClient }),
        new GfriendsActorSource({ networkClient }),
        new AvjohoActorSource({ networkClient }),
        new AvbaseActorSource({ networkClient }),
      ]),
    });

    const container: ServiceContainer = {
      signalService,
      windowService,
      networkClient,
      fetchGateway,
      scraperService: new ScraperService(
        signalService,
        networkClient,
        crawlerProvider,
        actorImageService,
        actorSourceProvider,
      ),
      maintenanceService: new MaintenanceService(
        signalService,
        networkClient,
        crawlerProvider,
        actorImageService,
        actorSourceProvider,
      ),
      crawlerProvider,
      actorSourceProvider,
      actorImageService,
      jellyfinActorPhotoService: new JellyfinActorPhotoService({ signalService, networkClient, actorSourceProvider }),
      jellyfinActorInfoService: new JellyfinActorInfoService({ signalService, networkClient, actorSourceProvider }),
      embyActorPhotoService: new EmbyActorPhotoService({ signalService, networkClient, actorSourceProvider }),
      embyActorInfoService: new EmbyActorInfoService({ signalService, networkClient, actorSourceProvider }),
      symlinkService: new SymlinkService({ signalService }),
      amazonPosterToolService: new AmazonPosterToolService(networkClient, amazonJpImageService),
    };

    registerIpcHandlers(container);
    ipcRegistered = true;
  }

  await windowService.loadMainWindow();
};

const cleanupResources = async (): Promise<void> => {
  if (cleaningUp) {
    return;
  }

  cleaningUp = true;
  disposeLoggerListener?.();
  disposeLoggerListener = null;
  disposeShortcutConfigListener?.();
  disposeShortcutConfigListener = null;
  shortcutService.dispose();
  trayService.dispose();
  await loggerService.close();
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
        await configManager.ensureLoaded();
        const initialConfig = (await configManager.get()) as Configuration;
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
          const networkClient = new NetworkClient({
            getProxyUrl: () => configManager.getComputed().proxyUrl,
            getTimeoutMs: () => configManager.getComputed().networkTimeoutMs,
            getRetryCount: () => configManager.getComputed().networkRetryCount,
          });
          const updateService = new UpdateService(networkClient);
          setTimeout(() => {
            void updateService.checkAndNotify(signalService);
          }, 5000);
        }
      }

      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          void ensureMainWindow().then(() => {
            if (windowService) {
              void configManager.ensureLoaded().then(async () => {
                if (!windowService) {
                  return;
                }
                shortcutService.initialize(windowService, (await configManager.get()) as Configuration);
              });
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

  app.on("before-quit", () => {
    void cleanupResources();
  });

  app.on("will-quit", () => {
    void cleanupResources();
  });
}
