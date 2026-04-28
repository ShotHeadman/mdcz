import type { ActorSourceProvider } from "@main/services/actorSource";
import type { Configuration } from "@main/services/config";
import { assertLocalActorImageSourceReady } from "@main/services/config/actorPhotoPath";
import { loggerService } from "@main/services/LoggerService";
import { runMediaServerPhotoSync } from "@main/services/mediaServer/MediaServerPhotoSync";
import type { NetworkClient } from "@main/services/network";
import type { SignalService } from "@main/services/SignalService";
import {
  type EmbyBatchResult,
  type EmbyMode,
  fetchActorPersons,
  hasPrimaryImage,
  refreshPerson,
  resolveEmbyUserId,
  uploadEmbyPrimaryImage,
} from "./common";

export interface EmbyActorPhotoDependencies {
  signalService: SignalService;
  networkClient: NetworkClient;
  actorSourceProvider: ActorSourceProvider;
}

export class EmbyActorPhotoService {
  private readonly logger = loggerService.getLogger("EmbyActorPhoto");

  private readonly networkClient: NetworkClient;

  constructor(private readonly deps: EmbyActorPhotoDependencies) {
    this.networkClient = deps.networkClient;
  }

  async run(configuration: Configuration, mode: EmbyMode): Promise<EmbyBatchResult> {
    assertLocalActorImageSourceReady(configuration);
    const resolvedUserId = await resolveEmbyUserId(this.networkClient, configuration);
    return await runMediaServerPhotoSync({
      configuration,
      mode,
      serviceName: "Emby",
      signalService: this.deps.signalService,
      networkClient: this.networkClient,
      actorSourceProvider: this.deps.actorSourceProvider,
      logger: this.logger,
      fetchPersons: async () =>
        await fetchActorPersons(this.networkClient, configuration, {
          userId: resolvedUserId,
        }),
      getPersonName: (person) => person.Name,
      getPersonId: (person) => person.Id,
      hasPrimaryImage,
      uploadPrimaryImage: async (personId, bytes, contentType) => {
        await uploadEmbyPrimaryImage(this.networkClient, configuration, personId, bytes, contentType);
      },
      shouldRefreshPerson: configuration.emby.refreshPersonAfterSync,
      refreshPerson: async (personId) => {
        await refreshPerson(this.networkClient, configuration, personId);
      },
      buildCompletionMessage: (result, total) =>
        `Emby actor photo sync completed. Total: ${total}, Success: ${result.processedCount}, Failed: ${result.failedCount}, Skipped: ${result.skippedCount}`,
    });
  }
}
