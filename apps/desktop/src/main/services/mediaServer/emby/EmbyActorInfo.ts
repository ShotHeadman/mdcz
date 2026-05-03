import type { ActorSourceProvider } from "@main/services/actorSource";
import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient } from "@main/services/network";
import type { SignalService } from "@main/services/SignalService";
import {
  type EmbyBatchResult,
  type EmbyMode,
  EmbyActorInfoService as RuntimeEmbyActorInfoService,
} from "@mdcz/runtime/mediaserver";

export interface EmbyActorInfoDependencies {
  signalService: SignalService;
  networkClient: NetworkClient;
  actorSourceProvider: ActorSourceProvider;
}

export class EmbyActorInfoService {
  private readonly logger = loggerService.getLogger("EmbyActorInfo");

  private readonly runtimeService: RuntimeEmbyActorInfoService;

  constructor(deps: EmbyActorInfoDependencies) {
    this.runtimeService = new RuntimeEmbyActorInfoService({
      ...deps,
      logger: this.logger,
    });
  }

  async run(configuration: Configuration, mode: EmbyMode): Promise<EmbyBatchResult> {
    return await this.runtimeService.run(configuration, mode);
  }
}
