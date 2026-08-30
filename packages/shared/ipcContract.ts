import type { AppIpcContract } from "./ipc-contracts/appContract";
import type { ConfigIpcContract } from "./ipc-contracts/configContract";
import type { CrawlerIpcContract } from "./ipc-contracts/crawlerContract";
import type { FileIpcContract } from "./ipc-contracts/fileContract";
import type { LibraryIpcContract } from "./ipc-contracts/libraryContract";
import type { MaintenanceIpcContract } from "./ipc-contracts/maintenanceContract";
import type { MediaRootsIpcContract } from "./ipc-contracts/mediaRootsContract";
import type { NetworkIpcContract } from "./ipc-contracts/networkContract";
import type { OverviewIpcContract } from "./ipc-contracts/overviewContract";
import type { ScraperIpcContract } from "./ipc-contracts/scraperContract";
import type { ToolIpcContract } from "./ipc-contracts/toolContract";
import type { TranslateIpcContract } from "./ipc-contracts/translateContract";

export type IpcRouterContract = AppIpcContract &
  ConfigIpcContract &
  ScraperIpcContract &
  CrawlerIpcContract &
  OverviewIpcContract &
  LibraryIpcContract &
  MediaRootsIpcContract &
  NetworkIpcContract &
  TranslateIpcContract &
  FileIpcContract &
  ToolIpcContract &
  MaintenanceIpcContract;
