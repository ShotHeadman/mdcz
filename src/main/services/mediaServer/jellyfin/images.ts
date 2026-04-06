import type { ActorSourceProvider } from "@main/services/actorSource";
import type { Configuration } from "@main/services/config";
import { assertLocalActorImageSourceReady } from "@main/services/config/actorPhotoPath";
import { loggerService } from "@main/services/LoggerService";
import {
  fetchJellyfinPersons,
  hasJellyfinPrimaryImage,
  type JellyfinBatchResult,
  uploadJellyfinPrimaryImage,
} from "@main/services/mediaServer/jellyfin/JellyfinAdapter";
import { runMediaServerPhotoSync } from "@main/services/mediaServer/MediaServerPhotoSync";
import type { NetworkClient } from "@main/services/network";
import type { SignalService } from "@main/services/SignalService";
import type { JellyfinMode } from "./auth";
import { refreshPerson } from "./people";

export interface JellyfinActorPhotoDependencies {
  signalService: SignalService;
  networkClient: NetworkClient;
  actorSourceProvider: ActorSourceProvider;
}

export class JellyfinActorPhotoService {
  private readonly logger = loggerService.getLogger("JellyfinActorPhoto");

  private readonly networkClient: NetworkClient;

  constructor(private readonly deps: JellyfinActorPhotoDependencies) {
    this.networkClient = deps.networkClient;
  }

  async run(configuration: Configuration, mode: JellyfinMode): Promise<JellyfinBatchResult> {
    assertLocalActorImageSourceReady(configuration);
    return await runMediaServerPhotoSync({
      configuration,
      mode,
      serviceName: "Jellyfin",
      signalService: this.deps.signalService,
      networkClient: this.networkClient,
      actorSourceProvider: this.deps.actorSourceProvider,
      logger: this.logger,
      fetchPersons: async () => await fetchJellyfinPersons(this.networkClient, configuration),
      getPersonName: (person) => person.Name,
      getPersonId: (person) => person.Id,
      hasPrimaryImage: hasJellyfinPrimaryImage,
      uploadPrimaryImage: async (personId, bytes, contentType) => {
        await uploadJellyfinPrimaryImage(this.networkClient, configuration, personId, bytes, contentType);
      },
      shouldRefreshPerson: configuration.jellyfin.refreshPersonAfterSync,
      refreshPerson: async (personId) => {
        await refreshPerson(this.networkClient, configuration, personId);
      },
    });
  }
}
