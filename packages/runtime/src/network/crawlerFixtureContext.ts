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

export interface CrawlerFixtureContext {
  item: ScrapeItemContext & { caseId: string };
  source: CrawlerSourceContext;
}

interface ScrapeExecutionContext {
  item?: ScrapeItemContext & { active: boolean };
  source?: CrawlerSourceContext & { active: boolean };
}

const scrapeExecutionStorage = new AsyncLocalStorage<ScrapeExecutionContext>();

export const preserveScrapeExecutionContext = <T extends () => unknown>(run: T): T => {
  const store = scrapeExecutionStorage.getStore();
  if (!store) return run;
  return (() => scrapeExecutionStorage.run(store, run)) as T;
};

export const runWithScrapeItemContext = async <T>(context: ScrapeItemContext, run: () => Promise<T>): Promise<T> => {
  const item = { ...context, active: true };
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

export const getScrapeItemContext = (): ScrapeItemContext | undefined => {
  const item = scrapeExecutionStorage.getStore()?.item;
  if (!item?.active) return undefined;
  const { active: _, ...context } = item;
  return context;
};

export const getCrawlerSourceContext = (): CrawlerSourceContext | undefined => {
  const source = scrapeExecutionStorage.getStore()?.source;
  return source?.active ? { website: source.website } : undefined;
};

export const getCrawlerFixtureContext = (): CrawlerFixtureContext | undefined => {
  const active = scrapeExecutionStorage.getStore();
  const caseId = active?.item?.caseId?.trim();
  if (!active?.item?.active || !active.source?.active || !caseId) return undefined;

  return {
    item: { itemId: active.item.itemId, relativePath: active.item.relativePath, caseId },
    source: { website: active.source.website },
  };
};
