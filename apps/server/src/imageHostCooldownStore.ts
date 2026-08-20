import path from "node:path";
import { PersistentCooldownStore } from "@mdcz/runtime/cooldown";
import { runtimeLoggerService } from "@mdcz/runtime/shared";
import type { ServerConfigService } from "./services/configService";

const stores = new WeakMap<ServerConfigService, PersistentCooldownStore>();

export const getServerImageHostCooldownStore = (config: ServerConfigService): PersistentCooldownStore => {
  const existing = stores.get(config);
  if (existing) return existing;

  const store = new PersistentCooldownStore({
    filePath: path.join(config.runtimePaths.dataDir, "image-host-cooldowns.json"),
    logger: runtimeLoggerService.getLogger("ImageHostCooldownStore"),
  });
  stores.set(config, store);
  return store;
};
