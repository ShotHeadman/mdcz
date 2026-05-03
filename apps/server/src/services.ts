import type { AuthService } from "./authService";
import type { BrowserService } from "./browserService";
import type { ServerConfigService } from "./configService";
import type { DiagnosticsService } from "./diagnosticsService";
import type { MediaRootService } from "./mediaRootService";
import type { ServerPersistenceService } from "./persistenceService";
import type { ScanQueueService } from "./scanQueueService";
import type { TaskEventBus } from "./taskEvents";

export interface ServerServices {
  auth: AuthService;
  browser: BrowserService;
  config: ServerConfigService;
  diagnostics: DiagnosticsService;
  mediaRoots: MediaRootService;
  persistence: ServerPersistenceService;
  scans: ScanQueueService;
  taskEvents: TaskEventBus;
}
