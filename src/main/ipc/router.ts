import type { ServiceContainer } from "@main/container";
import type { IpcRouterContract } from "@shared/ipcContract";
import { createAppHandlers } from "./handlers/app";
import { createConfigHandlers } from "./handlers/config";
import { createCrawlerHandlers } from "./handlers/crawler";
import { createFileHandlers } from "./handlers/file";
import { createNetworkHandlers } from "./handlers/network";
import { createScraperHandlers } from "./handlers/scraper";
import { createToolHandlers } from "./handlers/tool";
import { createTranslateHandlers } from "./handlers/translate";

export const createIpcRouter = (context: ServiceContainer): IpcRouterContract => ({
  ...createAppHandlers(),
  ...createConfigHandlers(),
  ...createScraperHandlers(context),
  ...createCrawlerHandlers(context),
  ...createNetworkHandlers(context),
  ...createFileHandlers(context),
  ...createToolHandlers(context),
  ...createTranslateHandlers(),
});
