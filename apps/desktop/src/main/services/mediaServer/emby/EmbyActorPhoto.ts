import type { ActorSourceProvider } from "@main/services/actorSource";
import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient } from "@main/services/network";
import type { SignalService } from "@main/services/SignalService";
import {
  type EmbyBatchResult,
  type EmbyMode,
  EmbyActorPhotoService as RuntimeEmbyActorPhotoService,
} from "@mdcz/runtime/mediaserver";

export interface EmbyActorPhotoDependencies {
  signalService: SignalService;
  networkClient: NetworkClient;
  actorSourceProvider: ActorSourceProvider;
}

export class EmbyActorPhotoService {
  private readonly logger = loggerService.getLogger("EmbyActorPhoto");

  private readonly runtimeService: RuntimeEmbyActorPhotoService;

  constructor(deps: EmbyActorPhotoDependencies) {
    this.runtimeService = new RuntimeEmbyActorPhotoService({
      ...deps,
      logger: this.logger,
    });
  }

  async run(configuration: Configuration, mode: EmbyMode): Promise<EmbyBatchResult> {
    return await this.runtimeService.run(configuration, mode);
  }
}
