import type { ServerConfigService } from "./configService";
import type { ServerPersistenceService } from "./persistenceService";
import type { TaskEventBus } from "./taskEvents";

export interface ServerServices {
  config: ServerConfigService;
  persistence: ServerPersistenceService;
  taskEvents: TaskEventBus;
}
