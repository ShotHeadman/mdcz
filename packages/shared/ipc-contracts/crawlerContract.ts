import type { Website } from "../enums";
import { IpcChannel } from "../IpcChannel";
import type { IpcProcedure } from "../ipcTypes";
import type { CrawlerData } from "../types";

export type CrawlerIpcContract = {
  [IpcChannel.Crawler_Test]: IpcProcedure<
    { site?: Website; number?: string },
    { data: CrawlerData | null; error?: string; elapsed: number }
  >;
  [IpcChannel.Crawler_ListSites]: IpcProcedure<void, unknown>;
};
