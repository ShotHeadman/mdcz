import type { OfficialActorSourceDependencies, OfficialSiteAdapter } from "../types";
import { DahliaOfficialAdapter } from "./dahlia";
import { FalenoOfficialAdapter } from "./faleno";
import { KmProduceOfficialAdapter } from "./kmProduce";
import { MgstageOfficialAdapter } from "./mgstage";
import { PrestigeOfficialAdapter } from "./prestige";

export const createOfficialStudioAdapters = (deps: OfficialActorSourceDependencies): OfficialSiteAdapter[] => {
  return [
    new PrestigeOfficialAdapter(deps),
    new FalenoOfficialAdapter(deps),
    new DahliaOfficialAdapter(deps),
    new KmProduceOfficialAdapter(deps),
    new MgstageOfficialAdapter(deps),
  ];
};
