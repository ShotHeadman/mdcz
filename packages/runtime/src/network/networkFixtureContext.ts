import { AsyncLocalStorage } from "node:async_hooks";
import type { Website } from "@mdcz/shared/enums";
import {
  installNetworkExecutionHooks,
  type NetworkExecutionHooks,
  type ScrapeItemExecutionContext,
} from "./networkExecution";

interface FixtureExecutionContext {
  item?: ScrapeItemExecutionContext & { active: boolean };
  source?: { website: Website; active: boolean };
  channel?: { active: boolean; name: string };
  sharedData?: { active: boolean };
}

const storage = new AsyncLocalStorage<FixtureExecutionContext>();

const hooks: NetworkExecutionHooks = {
  preserve: <T extends () => unknown>(run: T): T => {
    const store = storage.getStore();
    if (!store) return run;
    return (() => storage.run(store, run)) as T;
  },
  runWithScrapeItem: async <T>(context: ScrapeItemExecutionContext, run: () => Promise<T>): Promise<T> => {
    const item = { ...context, active: true };
    try {
      return await storage.run({ item }, run);
    } finally {
      item.active = false;
    }
  },
  runWithCrawlerSource: async <T>(website: Website, run: () => Promise<T>): Promise<T> => {
    const active = storage.getStore();
    const source = { website, active: true };
    try {
      return await storage.run({ ...active, source }, run);
    } finally {
      source.active = false;
    }
  },
  runWithChannel: async <T>(channel: string, run: () => Promise<T>): Promise<T> => {
    const active = storage.getStore();
    const channelContext = { active: true, name: channel };
    try {
      return await storage.run({ ...active, channel: channelContext }, run);
    } finally {
      channelContext.active = false;
    }
  },
  runWithSharedData: async <T>(run: () => Promise<T>): Promise<T> => {
    const active = storage.getStore();
    const sharedData = { active: true };
    try {
      return await storage.run({ ...active, sharedData }, run);
    } finally {
      sharedData.active = false;
    }
  },
  getCrawlerSource: () => {
    const source = storage.getStore()?.source;
    return source?.active ? { website: source.website } : undefined;
  },
  getNetworkRequest: () => {
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
  },
};

let installed = false;

export const activateNetworkFixtureContext = (): void => {
  if (installed) return;
  installNetworkExecutionHooks(hooks);
  installed = true;
};
