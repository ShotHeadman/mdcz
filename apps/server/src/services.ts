import type { AuthService } from "./services/authService";
import type { AutomationService, AutomationWebhookOptions } from "./services/automationService";
import type { BrowserService } from "./services/browserService";
import type { ServerConfigService } from "./services/configService";
import type { FolderWatchService } from "./services/folderWatchService";
import type { LibraryService } from "./services/libraryService";
import type { MaintenanceService } from "./services/maintenanceService";
import type { MediaRootService } from "./services/mediaRootService";
import type { ServerPersistenceService } from "./services/persistenceService";
import type { RuntimeActionService } from "./services/runtimeActionService";
import type { RuntimeLogService } from "./services/runtimeLogService";
import type { ScanQueueService } from "./services/scanQueueService";
import type { ScrapeService } from "./services/scrapeService";
import type { ServerPathService } from "./services/serverPathService";
import type { SystemService } from "./services/systemService";
import type { ToolsService } from "./services/toolsService";
import type { TaskEventBus } from "./taskEvents";

export interface ServerServices {
  automation: AutomationService;
  auth: AuthService;
  browser: BrowserService;
  config: ServerConfigService;
  folderWatch: FolderWatchService;
  library: LibraryService;
  maintenance: MaintenanceService;
  mediaRoots: MediaRootService;
  persistence: ServerPersistenceService;
  runtimeLogs: RuntimeLogService;
  runtimeActions: RuntimeActionService;
  scans: ScanQueueService;
  scrape: ScrapeService;
  serverPaths: ServerPathService;
  system: SystemService;
  taskEvents: TaskEventBus;
  tools: ToolsService;
}

export interface ServerServiceOptions {
  automationWebhook?: AutomationWebhookOptions;
}
