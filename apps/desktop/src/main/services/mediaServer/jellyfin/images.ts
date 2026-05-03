import type { ActorSourceProvider } from "@main/services/actorSource";
import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient } from "@main/services/network";
import type { SignalService } from "@main/services/SignalService";
import {
  type JellyfinBatchResult,
  JellyfinActorPhotoService as RuntimeJellyfinActorPhotoService,
} from "@mdcz/runtime/mediaserver";
import type { JellyfinMode } from "./auth";

export interface JellyfinActorPhotoDependencies {
  signalService: SignalService;
  networkClient: NetworkClient;
  actorSourceProvider: ActorSourceProvider;
}

export class JellyfinActorPhotoService {
  private readonly logger = loggerService.getLogger("JellyfinActorPhoto");

  private readonly runtimeService: RuntimeJellyfinActorPhotoService;

  constructor(deps: JellyfinActorPhotoDependencies) {
    this.runtimeService = new RuntimeJellyfinActorPhotoService({
      ...deps,
      logger: this.logger,
    });
  }

  async run(configuration: Configuration, mode: JellyfinMode): Promise<JellyfinBatchResult> {
    return await this.runtimeService.run(configuration, mode);
  }
}
