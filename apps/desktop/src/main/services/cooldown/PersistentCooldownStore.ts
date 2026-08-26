import { join } from "node:path";
import { getDesktopUserDataPath } from "@main/appIdentity";
import { loggerService } from "@main/services/LoggerService";
import {
  PersistentCooldownStore as RuntimePersistentCooldownStore,
  type PersistentCooldownStoreOptions as RuntimePersistentCooldownStoreOptions,
} from "@mdcz/runtime/cooldown";

interface PersistentCooldownStoreOptions {
  fileName?: string;
  filePath?: string;
  loggerName?: string;
  persistDelayMs?: number;
}

const resolveStorePath = (fileName: string): string => {
  try {
    return join(getDesktopUserDataPath(), fileName);
  } catch {
    return join(process.cwd(), ".tmp", fileName);
  }
};

export class PersistentCooldownStore extends RuntimePersistentCooldownStore {
  constructor(options: PersistentCooldownStoreOptions = {}) {
    super({
      filePath: options.filePath ?? resolveStorePath(options.fileName ?? "cooldowns.json"),
      logger: loggerService.getLogger(options.loggerName ?? "PersistentCooldownStore"),
      persistDelayMs: options.persistDelayMs,
    } satisfies RuntimePersistentCooldownStoreOptions);
  }
}

export const createImageHostCooldownStore = (): PersistentCooldownStore =>
  new PersistentCooldownStore({
    fileName: "image-host-cooldowns.json",
    loggerName: "ImageHostCooldownStore",
  });
