import { join } from "node:path";
import { createAppNetworkClient, prepareAppScrapeItem } from "@main/networkComposition";
import { resolveSiteProxyUrl } from "@mdcz/runtime/config";
import { runtimeLoggerService } from "@mdcz/runtime/shared";
import { FileTranslationMappingStore } from "@mdcz/runtime/translate";
import { buildServer, type ServerApp } from "@mdcz/server/app";
import { ServerConfigService } from "@mdcz/server/services/configService";
import { ServerPersistenceService } from "@mdcz/server/services/persistenceService";
import { RuntimeLogService } from "@mdcz/server/services/runtimeLogService";
import { createTaskEventBus } from "@mdcz/server/taskEvents";
import type { Configuration } from "@mdcz/shared/config";
import { app, BrowserWindow, dialog, protocol } from "electron";
import { createApiRequestHandler, registerApiScheme } from "./apiProtocol";
import { applyDesktopAppIdentity } from "./appIdentity";
import { registerDesktopBridge } from "./desktopBridge";
import { localAuth } from "./localAuth";
import { createLogFile } from "./logFile";
import { openDatabase } from "./openDatabase";
import { createQuitGuard } from "./quitGuard";
import { API_SCHEME } from "./rendererTrust";
import { createElectronCookieResolver } from "./services/CookieResolver";
import { ShortcutService } from "./services/ShortcutService";
import { TrayService } from "./services/TrayService";
import { UpdateService } from "./services/UpdateService";
import { WindowService } from "./services/WindowService";

const QUIT_FORCE_EXIT_TIMEOUT_MS = 15_000;
const QUIT_DIALOG_TEXT = {
  zh: { message: "仍有任务在运行。退出并停止它？", buttons: ["退出并停止", "取消"] },
  en: { message: "A task is still running. Quit and stop it?", buttons: ["Quit and stop", "Cancel"] },
};
// Set by the dev config once web's Vite server listens; packaged builds serve web's build from the asar.
const devServerUrl = process.env.MDCZ_WEB_DEV_URL;
const userData = applyDesktopAppIdentity();
const nativeBinding = app.isPackaged
  ? join(process.resourcesPath, "native", "better_sqlite3.node")
  : join(app.getAppPath(), "native", "better_sqlite3.node");

registerApiScheme();

const windowService = new WindowService();
const trayService = new TrayService();
const shortcutService = new ShortcutService();
let server: ServerApp | null = null;
let updateService: UpdateService | null = null;
let closeLogFile: (() => Promise<void>) | null = null;
let quitRequested = false;
let cleanupFinished = false;

const confirmQuitWhileTaskRuns = async (): Promise<boolean> => {
  const window = windowService.getMainWindow();
  // The page keeps the language the user picked; a page that cannot answer must not keep the app from quitting.
  const pageLocale = await window?.webContents.executeJavaScript("document.documentElement.lang").catch(() => "");
  const text =
    QUIT_DIALOG_TEXT[
      String(pageLocale || app.getLocale())
        .toLowerCase()
        .startsWith("zh")
        ? "zh"
        : "en"
    ];
  const options = {
    type: "warning" as const,
    title: "MDCz",
    message: text.message,
    buttons: text.buttons,
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
  const { response } = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
  return response === 0;
};

const holdQuit = createQuitGuard({
  taskRunning: () => server?.taskRunning() ?? false,
  confirm: confirmQuitWhileTaskRuns,
});

const openMainWindow = async (configuration: Configuration): Promise<void> => {
  windowService.createMainWindow({ useCustomTitleBar: configuration.ui.useCustomTitleBar, holdClose: holdQuit });
  shortcutService.initialize(windowService, configuration);
  windowService.applyUiConfig(configuration.ui);
  await windowService.loadMainWindow();
};

const start = async (): Promise<void> => {
  const paths = {
    configDir: join(userData, "config"),
    dataDir: userData,
    configPath: join(userData, "config", "default.toml"),
    databasePath: join(userData, "mdcz.sqlite"),
  };
  const logFile = createLogFile(join(userData, "logs"));
  closeLogFile = logFile.close;
  const config = new ServerConfigService(paths);
  const persistence = new ServerPersistenceService(paths, { nativeBinding });
  const taskEvents = createTaskEventBus();
  server = buildServer({
    backgroundAutomation: false,
    webStaticDir: devServerUrl ? false : join(__dirname, "../web"),
    services: {
      auth: localAuth,
      config,
      persistence,
      runtimeLogs: new RuntimeLogService(1000, taskEvents, logFile.sink),
      taskEvents,
    },
    resources: {
      networkClient: createAppNetworkClient({
        getProxyUrl: (site) => resolveSiteProxyUrl(config.getComputed(), site),
        getTimeoutMs: () => config.getComputed().networkTimeoutMs,
        getRetryCount: () => config.getComputed().networkRetryCount,
      }),
      prepareScrapeItem: prepareAppScrapeItem,
      mappingStore: new FileTranslationMappingStore(
        app.isPackaged
          ? join(process.resourcesPath, "mapping_table")
          : join(app.getAppPath(), "../../packages/runtime/resources/mapping_table"),
      ),
      avjohoCookieResolver: createElectronCookieResolver({ expectedCookieNames: ["wsidchk"] }),
    },
  });
  if (!(await openDatabase(persistence, nativeBinding))) {
    app.quit();
    return;
  }
  await server.fastify.ready();
  const handleApiRequest = createApiRequestHandler(server.fastify, devServerUrl);
  // A closing page still resyncs when its event stream drops, after the server has begun shutting down.
  protocol.handle(API_SCHEME, async (request) =>
    quitRequested ? new Response(null, { status: 503 }) : await handleApiRequest(request),
  );
  updateService = new UpdateService(
    (status) => windowService.send("updateStatus", status),
    () => config.getComputed().proxyUrl,
  );
  registerDesktopBridge({ services: server.services, updateService, windowService });

  const configuration = await config.get();
  await openMainWindow(configuration);
  trayService.initialize(windowService);
  config.onChange((event) => {
    shortcutService.initialize(windowService, event.configuration);
    windowService.applyUiConfig(event.configuration.ui);
  });
  if (configuration.behavior.updateCheck && app.isPackaged) {
    setTimeout(() => void updateService?.check(), 5000);
  }
};

const cleanup = async (): Promise<void> => {
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  try {
    await server?.fastify.close();
  } catch (error) {
    runtimeLoggerService.getLogger("Main").error(`Failed to shut down cleanly: ${String(error)}`);
    process.exitCode = 1;
  }
  try {
    updateService?.installDownloadedUpdate();
  } catch (error) {
    runtimeLoggerService.getLogger("Main").error(`Failed to start the update installer: ${String(error)}`);
    process.exitCode = 1;
  }
  shortcutService.dispose();
  trayService.dispose();
  await closeLogFile?.();
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => windowService.showMainWindow());

  app
    .whenReady()
    .then(start)
    .catch((error) => {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      runtimeLoggerService.getLogger("Main").error(`Failed to start: ${message}`);
      // Startup fails before any window exists, so without this the app just vanishes.
      dialog.showErrorBox("MDCz failed to start", message);
      app.quit();
    });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length > 0) {
      windowService.showMainWindow();
      return;
    }
    if (server) void server.services.config.get().then(openMainWindow);
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", (event) => {
    if (cleanupFinished) return;
    event.preventDefault();
    if (quitRequested || !holdQuit(() => app.quit())) return;
    quitRequested = true;
    setTimeout(() => app.exit(Number(process.exitCode) || 1), QUIT_FORCE_EXIT_TIMEOUT_MS).unref();
    void cleanup().finally(() => {
      cleanupFinished = true;
      app.quit();
    });
  });
}
