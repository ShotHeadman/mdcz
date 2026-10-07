import { about } from "./about";
import { common } from "./common";
import { configForm } from "./configForm";
import { desktop } from "./desktop";
import { detail } from "./detail";
import { domain } from "./domain";
import { libraries } from "./libraries";
import { library } from "./library";
import { logs } from "./logs";
import { maintenance } from "./maintenance";
import { media } from "./media";
import { nfo } from "./nfo";
import { overview } from "./overview";
import { path } from "./path";
import { pending } from "./pending";
import { scrape } from "./scrape";
import { settings } from "./settings";
import { settingsFields } from "./settingsFields";
import { shell } from "./shell";
import { toolCatalog } from "./toolCatalog";
import { tools } from "./tools";
import { web } from "./web";
import { workbench } from "./workbench";

export const en = {
  common,
  shell,
  domain,
  settingsFields,
  toolCatalog,
  settings,
  configForm,
  library,
  libraries,
  pending,
  detail,
  nfo,
  overview,
  workbench,
  maintenance,
  scrape,
  tools,
  about,
  logs,
  path,
  media,
  web,
  desktop,
};

export type Messages = typeof en;
