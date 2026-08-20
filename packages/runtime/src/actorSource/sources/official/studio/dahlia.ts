import { Website } from "@mdcz/shared/enums";
import type { OfficialActorSourceDependencies } from "../types";
import { BaseFalenoOfficialAdapter } from "./BaseFalenoOfficialAdapter";

const DAHLIA_BASE_URL = "https://dahlia-av.jp";
const DAHLIA_STUDIO_PATTERN = /(dahlia|ダリア)/iu;

export class DahliaOfficialAdapter extends BaseFalenoOfficialAdapter {
  constructor(deps: OfficialActorSourceDependencies) {
    super(deps, {
      key: "dahlia",
      baseUrl: DAHLIA_BASE_URL,
      hintHosts: ["dahlia-av.jp"],
      rateLimitedHosts: ["dahlia-av.jp"],
      rosterPath: "/actress/",
      website: Website.DAHLIA,
      studio: "DAHLIA",
      studioPattern: DAHLIA_STUDIO_PATTERN,
    });
  }
}
