import {
  createImageHostCooldownStore,
  type PersistentCooldownStore,
} from "@main/services/cooldown/PersistentCooldownStore";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient } from "@main/services/network";
import {
  DownloadManager as RuntimeDownloadManager,
  type DownloadManagerOptions as RuntimeDownloadManagerOptions,
} from "@mdcz/runtime/scrape";

export type { DownloadCallbacks } from "@mdcz/runtime/scrape";

interface DownloadManagerOptions {
  imageHostCooldownStore?: PersistentCooldownStore;
}

const createRuntimeOptions = (options: DownloadManagerOptions): RuntimeDownloadManagerOptions => ({
  imageHostCooldownStore: options.imageHostCooldownStore ?? createImageHostCooldownStore(),
  logger: loggerService.getLogger("DownloadManager"),
});

export class DownloadManager extends RuntimeDownloadManager {
  constructor(networkClient: NetworkClient, options: DownloadManagerOptions = {}) {
    super(networkClient, createRuntimeOptions(options));
  }
}
