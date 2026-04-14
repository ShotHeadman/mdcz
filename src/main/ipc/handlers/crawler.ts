import type { ServiceContainer } from "@main/container";
import { configManager } from "@main/services/config";
import { buildCrawlerOptions } from "@main/services/scraper/crawlerOptions";
import { toErrorMessage } from "@main/utils/common";
import { Website } from "@shared/enums";
import { IpcChannel } from "@shared/IpcChannel";
import type { IpcRouterContract } from "@shared/ipcContract";
import { createIpcError, IpcErrorCode } from "../errors";
import { asSerializableIpcError, t } from "../shared";

const WEBSITE_VALUES = new Set(Object.values(Website));

const parseWebsite = (value: unknown): Website | null => {
  if (typeof value !== "string") {
    return null;
  }
  return WEBSITE_VALUES.has(value as Website) ? (value as Website) : null;
};

export const createCrawlerHandlers = (
  context: ServiceContainer,
): Pick<IpcRouterContract, typeof IpcChannel.Crawler_Test | typeof IpcChannel.Crawler_ListSites> => {
  const { crawlerProvider } = context;

  return {
    [IpcChannel.Crawler_Test]: t.procedure.input<{ site?: Website; number?: string }>().action(async ({ input }) => {
      try {
        const site = parseWebsite(input?.site);
        const number = input?.number?.trim();
        if (!site || !number) {
          throw createIpcError(IpcErrorCode.INVALID_ARGUMENT, "Both site and number are required");
        }

        const configuration = await configManager.getValidated();
        const response = await crawlerProvider.crawl({
          number,
          site,
          options: buildCrawlerOptions({
            site,
            configuration,
          }),
        });

        if (response.result.success) {
          return {
            data: response.result.data,
            elapsed: response.elapsedMs,
          };
        }

        return {
          data: null,
          error: response.result.error,
          elapsed: response.elapsedMs,
        };
      } catch (error) {
        const message = toErrorMessage(error);
        return { data: null, error: message, elapsed: 0 };
      }
    }),
    [IpcChannel.Crawler_ListSites]: t.procedure.action(async () => {
      try {
        const configuration = await configManager.getValidated();
        const enabledSites = new Set(configuration.scrape.sites);
        return {
          sites: crawlerProvider.listSites().map(({ site, native }) => ({
            site,
            name: site,
            enabled: enabledSites.has(site),
            native,
          })),
        };
      } catch (error) {
        throw asSerializableIpcError(error);
      }
    }),
  };
};
