import type { ServiceContainer } from "@main/container";
import type { IpcRouterContract } from "@mdcz/shared/ipcContract";
import { createAppHandlers } from "./handlers/app";
import { createConfigHandlers } from "./handlers/config";
import { createCrawlerHandlers } from "./handlers/crawler";
import { createFileHandlers } from "./handlers/file";
import { createLibraryHandlers } from "./handlers/library";
import { createMaintenanceHandlers } from "./handlers/maintenance";
import { createMediaRootHandlers } from "./handlers/mediaRoots";
import { createNetworkHandlers } from "./handlers/network";
import { createOverviewHandlers } from "./handlers/overview";
import { createScraperHandlers } from "./handlers/scraper";
import { createToolHandlers } from "./handlers/tool";
import { createTranslateHandlers } from "./handlers/translate";

export const createIpcRouter = (context: ServiceContainer): IpcRouterContract => ({
  ...createAppHandlers(context),
  ...createConfigHandlers(context),
  ...createScraperHandlers(context),
  ...createCrawlerHandlers(context),
  ...createOverviewHandlers(context),
  ...createLibraryHandlers(context),
  ...createMediaRootHandlers(context),
  ...createNetworkHandlers(context),
  ...createFileHandlers(context),
  ...createToolHandlers(context),
  ...createTranslateHandlers(context),
  ...createMaintenanceHandlers(context),
});
