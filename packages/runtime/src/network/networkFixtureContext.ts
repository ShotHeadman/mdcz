import { AsyncLocalStorage } from "node:async_hooks";
import type { Website } from "@mdcz/shared/enums";

export interface ScrapeItemContext {
  itemId: string;
  relativePath: string;
  caseId?: string;
}

export interface CrawlerSourceContext {
  website: Website;
}

interface ScrapeExecutionContext {
  item?: ScrapeItemContext & { active: boolean; execution: object };
  source?: CrawlerSourceContext & { active: boolean };
  fixtureChannel?: { active: boolean; name: string };
}

export interface NetworkFixtureContext {
  caseId: string;
  channel: string;
  execution: object;
}

const scrapeExecutionStorage = new AsyncLocalStorage<ScrapeExecutionContext>();

export const preserveScrapeExecutionContext = <T extends () => unknown>(run: T): T => {
  const store = scrapeExecutionStorage.getStore();
  if (!store) return run;
  return (() => scrapeExecutionStorage.run(store, run)) as T;
};

export const runWithScrapeItemContext = async <T>(context: ScrapeItemContext, run: () => Promise<T>): Promise<T> => {
  const item = { ...context, active: true, execution: {} };
  try {
    return await scrapeExecutionStorage.run({ item }, run);
  } finally {
    item.active = false;
  }
};

export const runWithCrawlerSourceContext = async <T>(website: Website, run: () => Promise<T>): Promise<T> => {
  const active = scrapeExecutionStorage.getStore();
  const source = { website, active: true };
  try {
    return await scrapeExecutionStorage.run({ ...active, source }, run);
  } finally {
    source.active = false;
  }
};

export const runWithNetworkFixtureChannel = async <T>(channel: string, run: () => Promise<T>): Promise<T> => {
  const active = scrapeExecutionStorage.getStore();
  const fixtureChannel = { active: true, name: channel };
  try {
    return await scrapeExecutionStorage.run({ ...active, fixtureChannel }, run);
  } finally {
    fixtureChannel.active = false;
  }
};

export const getScrapeItemContext = (): ScrapeItemContext | undefined => {
  const item = scrapeExecutionStorage.getStore()?.item;
  if (!item?.active) return undefined;
  return { itemId: item.itemId, relativePath: item.relativePath, caseId: item.caseId };
};

export const getCrawlerSourceContext = (): CrawlerSourceContext | undefined => {
  const source = scrapeExecutionStorage.getStore()?.source;
  return source?.active ? { website: source.website } : undefined;
};

export const getNetworkFixtureContext = (): NetworkFixtureContext | undefined => {
  const active = scrapeExecutionStorage.getStore();
  const caseId = active?.item?.caseId?.trim();
  if (!active?.item?.active || !caseId) return undefined;
  const channel = active.source?.active
    ? `crawler:${active.source.website}`
    : active.fixtureChannel?.active
      ? active.fixtureChannel.name
      : undefined;
  return channel ? { caseId, channel, execution: active.item.execution } : undefined;
};
