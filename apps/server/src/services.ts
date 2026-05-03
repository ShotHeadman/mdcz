import type { AuthService } from "./authService";
import type { AutomationService, AutomationWebhookOptions } from "./automationService";
import type { BrowserService } from "./browserService";
import type { ServerConfigService } from "./configService";
import type { DiagnosticsService } from "./diagnosticsService";
import type { LibraryService } from "./libraryService";
import type { MaintenanceService } from "./maintenanceService";
import type { MediaRootService } from "./mediaRootService";
import type { ServerPersistenceService } from "./persistenceService";
import type { RuntimeLogService } from "./runtimeLogService";
import type { ScanQueueService } from "./scanQueueService";
import type { ScrapeService } from "./scrapeService";
import type { SystemService } from "./systemService";
import type { TaskEventBus } from "./taskEvents";
import type { ToolsService } from "./toolsService";

export interface ServerServices {
  automation: AutomationService;
  auth: AuthService;
  browser: BrowserService;
  config: ServerConfigService;
  diagnostics: DiagnosticsService;
  library: LibraryService;
  maintenance: MaintenanceService;
  mediaRoots: MediaRootService;
  persistence: ServerPersistenceService;
  runtimeLogs: RuntimeLogService;
  scans: ScanQueueService;
  scrape: ScrapeService;
  system: SystemService;
  taskEvents: TaskEventBus;
  tools: ToolsService;
}

export interface ServerServiceOptions {
  automationWebhook?: AutomationWebhookOptions;
}
