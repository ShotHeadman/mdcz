import type { Website } from "@mdcz/shared/enums";

export interface ScrapeItemExecutionContext {
  itemId: string;
  relativePath: string;
  caseId?: string;
}

export interface CrawlerExecutionSource {
  website: Website;
}

export interface NetworkRequestExecutionContext {
  caseId: string;
  channel: string;
  execution: object;
  shared: boolean;
}

export interface NetworkExecutionHooks {
  preserve<T extends () => unknown>(run: T): T;
  runWithScrapeItem<T>(context: ScrapeItemExecutionContext, run: () => Promise<T>): Promise<T>;
  runWithCrawlerSource<T>(website: Website, run: () => Promise<T>): Promise<T>;
  runWithChannel<T>(channel: string, run: () => Promise<T>): Promise<T>;
  runWithSharedData<T>(run: () => Promise<T>): Promise<T>;
  getScrapeItem(): ScrapeItemExecutionContext | undefined;
  getCrawlerSource(): CrawlerExecutionSource | undefined;
  getNetworkRequest(): NetworkRequestExecutionContext | undefined;
}

const directExecutionHooks: NetworkExecutionHooks = {
  preserve: (run) => run,
  runWithScrapeItem: async (_context, run) => await run(),
  runWithCrawlerSource: async (_website, run) => await run(),
  runWithChannel: async (_channel, run) => await run(),
  runWithSharedData: async (run) => await run(),
  getScrapeItem: () => undefined,
  getCrawlerSource: () => undefined,
  getNetworkRequest: () => undefined,
};

let executionHooks = directExecutionHooks;

export const installNetworkExecutionHooks = (hooks: NetworkExecutionHooks): void => {
  executionHooks = hooks;
};

export const preserveNetworkExecutionContext = <T extends () => unknown>(run: T): T => executionHooks.preserve(run);

export const runWithScrapeItem = async <T>(context: ScrapeItemExecutionContext, run: () => Promise<T>): Promise<T> =>
  await executionHooks.runWithScrapeItem(context, run);

export const runWithCrawlerSource = async <T>(website: Website, run: () => Promise<T>): Promise<T> =>
  await executionHooks.runWithCrawlerSource(website, run);

export const runWithNetworkChannel = async <T>(channel: string, run: () => Promise<T>): Promise<T> =>
  await executionHooks.runWithChannel(channel, run);

export const runWithSharedNetworkData = async <T>(run: () => Promise<T>): Promise<T> =>
  await executionHooks.runWithSharedData(run);

export const getScrapeItemExecutionContext = (): ScrapeItemExecutionContext | undefined =>
  executionHooks.getScrapeItem();

export const getCrawlerExecutionSource = (): CrawlerExecutionSource | undefined => executionHooks.getCrawlerSource();

export const getNetworkRequestExecutionContext = (): NetworkRequestExecutionContext | undefined =>
  executionHooks.getNetworkRequest();

export class UnrecoverableNetworkError extends Error {}

export const isUnrecoverableNetworkError = (error: unknown): boolean => {
  let current = error;
  const visited = new Set<unknown>();
  while (current instanceof Error && !visited.has(current)) {
    if (current instanceof UnrecoverableNetworkError) return true;
    visited.add(current);
    current = current.cause;
  }
  return false;
};
