import type { ActorSourceProvider } from "@main/services/actorSource";
import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient } from "@main/services/network";
import type { SignalService } from "@main/services/SignalService";
import {
  fetchJellyfinMetadataEditorInfo,
  fetchJellyfinPersonDetail,
  fetchJellyfinPersons,
  type JellyfinBatchResult,
  type JellyfinItemDetail,
  type JellyfinPerson,
  JellyfinActorInfoService as RuntimeJellyfinActorInfoService,
  refreshJellyfinPerson,
  resolveJellyfinUserId,
  updateJellyfinPersonInfo,
} from "@mdcz/runtime/mediaserver";
import type { JellyfinMode } from "./auth";

export type { JellyfinBatchResult, JellyfinPerson };
export type ItemDetail = JellyfinItemDetail;
export { fetchJellyfinPersonDetail as fetchPersonDetail, fetchJellyfinPersons as fetchPersons, resolveJellyfinUserId };

export interface JellyfinActorInfoDependencies {
  signalService: SignalService;
  networkClient: NetworkClient;
  actorSourceProvider: ActorSourceProvider;
}

export const fetchMetadataEditorInfo = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  personId: string,
): Promise<Record<string, unknown>> => {
  return await fetchJellyfinMetadataEditorInfo(networkClient, configuration, personId);
};

export const refreshPerson = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  personId: string,
): Promise<void> => {
  await refreshJellyfinPerson(networkClient, configuration, personId);
};

export const updatePersonInfo = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  person: JellyfinPerson,
  detail: ItemDetail,
  synced: Parameters<typeof updateJellyfinPersonInfo>[4],
  options: {
    lockOverview?: boolean;
  } = {},
): Promise<void> => {
  await updateJellyfinPersonInfo(networkClient, configuration, person, detail, synced, options);
};

export class JellyfinActorInfoService {
  private readonly logger = loggerService.getLogger("JellyfinActorInfo");

  private readonly runtimeService: RuntimeJellyfinActorInfoService;

  constructor(private readonly deps: JellyfinActorInfoDependencies) {
    this.runtimeService = new RuntimeJellyfinActorInfoService({
      ...deps,
      logger: this.logger,
    });
  }

  async run(configuration: Configuration, mode: JellyfinMode): Promise<JellyfinBatchResult> {
    return await this.runtimeService.run(configuration, mode);
  }
}
