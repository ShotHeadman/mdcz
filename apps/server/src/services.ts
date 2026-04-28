import type { ServerConfigService } from "./configService";
import type { TaskEventBus } from "./taskEvents";

export interface ServerServices {
  config: ServerConfigService;
  taskEvents: TaskEventBus;
}
