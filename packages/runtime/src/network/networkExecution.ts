import { AsyncLocalStorage } from "node:async_hooks";
import type { Website } from "@mdcz/shared/enums";
import type { SiteResult } from "@mdcz/shared/siteResults";

export interface ScrapeItemExecutionContext {
  caseId?: string;
  /**
   * One scrape of a movie. Its prepare and publish phases run separately but must pass the same object,
   * because a recording and a replay cursor cover the whole scrape.
   */
  execution: object;
}

/** A crawler's time budget, paused while its requests wait in the local rate limiter rather than on the site. */
export interface CrawlerBudget {
  pause(): void;
  resume(): void;
}

export interface CrawlerExecutionSource {
  website: Website;
  budget?: CrawlerBudget;
}

export interface NetworkRequestExecutionContext {
  caseId: string;
  channel: string;
  execution: object;
  shared: boolean;
}

export interface ScrapeItemObserver {
  siteSettled(item: ScrapeItemExecutionContext, result: SiteResult): void;
  phaseEnded(item: ScrapeItemExecutionContext): Promise<void>;
}

interface ExecutionStore {
  item?: ScrapeItemExecutionContext & { active: boolean };
  source?: CrawlerExecutionSource & { active: boolean };
  channel?: { name: string; active: boolean };
  sharedData?: { active: boolean };
}

const storage = new AsyncLocalStorage<ExecutionStore>();
let observer: ScrapeItemObserver | undefined;

// Scopes are deactivated on exit because detached promises keep the store they were created in.
const runScoped = async <T, K extends keyof ExecutionStore>(
  key: K,
  scope: NonNullable<ExecutionStore[K]>,
  run: () => Promise<T>,
  inherit = true,
): Promise<T> => {
  try {
    return await storage.run({ ...(inherit ? storage.getStore() : {}), [key]: scope }, run);
  } finally {
    scope.active = false;
  }
};

export const preserveNetworkExecutionContext = <T extends () => unknown>(run: T): T => {
  const store = storage.getStore();
  return store ? ((() => storage.run(store, run)) as T) : run;
};

/** Only one network fixture client records or replays per process, so the latest one observes. */
export const observeScrapeItems = (next: ScrapeItemObserver): void => {
  observer = next;
};

export const runWithScrapeItem = async <T>(context: ScrapeItemExecutionContext, run: () => Promise<T>): Promise<T> => {
  try {
    return await runScoped("item", { ...context, active: true }, run, false);
  } finally {
    await observer?.phaseEnded(context);
  }
};

export const runWithCrawlerSource = async <T>(
  website: Website,
  run: () => Promise<T>,
  budget?: CrawlerBudget,
): Promise<T> => await runScoped("source", { website, budget, active: true }, run);

export const runWithNetworkChannel = async <T>(channel: string, run: () => Promise<T>): Promise<T> =>
  await runScoped("channel", { name: channel, active: true }, run);

export const runWithSharedNetworkData = async <T>(run: () => Promise<T>): Promise<T> =>
  await runScoped("sharedData", { active: true }, run);

export const reportSiteResult = (result: SiteResult): void => {
  const item = storage.getStore()?.item;
  if (item?.active) observer?.siteSettled(item, result);
};

export const getCrawlerExecutionSource = (): CrawlerExecutionSource | undefined => {
  const source = storage.getStore()?.source;
  return source?.active ? { website: source.website, budget: source.budget } : undefined;
};

export const getNetworkRequestExecutionContext = (): NetworkRequestExecutionContext | undefined => {
  const active = storage.getStore();
  const caseId = active?.item?.caseId?.trim();
  if (!active?.item?.active || !caseId) return undefined;
  const channel = active.source?.active
    ? `crawler:${active.source.website}`
    : active.channel?.active
      ? active.channel.name
      : undefined;
  return channel
    ? { caseId, channel, execution: active.item.execution, shared: active.sharedData?.active === true }
    : undefined;
};

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
