import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import type { SignalService } from "@main/services/SignalService";
import type { ActorSourceProvider } from "@mdcz/runtime/actorSource";
import {
  type EmbyBatchResult,
  type EmbyMode,
  EmbyActorInfoService as RuntimeEmbyActorInfoService,
} from "@mdcz/runtime/mediaserver";
import type { NetworkClient } from "@mdcz/runtime/network";

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
