import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import type { SignalService } from "@main/services/SignalService";
import type { ActorSourceProvider } from "@mdcz/runtime/actorSource";
import {
  type EmbyBatchResult,
  type EmbyMode,
  EmbyActorPhotoService as RuntimeEmbyActorPhotoService,
} from "@mdcz/runtime/mediaserver";
import type { NetworkClient } from "@mdcz/runtime/network";

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
